/**
 * Price authority: the lightweight, webhook driven pricing service.
 *
 * The store is the commercial system of record for the catalogue and for the
 * final retail price customers pay. NUR GOODS owns the calculation that sets
 * that price, and this module is the only place allowed to write it back.
 *
 *   cost of goods    store inventory unit cost -> NUR GOODS calculation
 *   retail price     NUR GOODS calculation     -> store variants
 *
 * The rule is a markup on PROTECTED LANDED COST with payment fee protection,
 * defined once in canonical.ts. Landed cost is the store's own cost of goods
 * plus the supplier's destination specific shipping quote, converted at a rate
 * deliberately worse than the reference rate, taken from the worst of the free
 * shipping markets. Delivery is free to the customer, so supplier shipping is
 * a cost of goods and must be inside the price. Nothing here prices from the
 * item cost alone.
 *
 * Everything fails closed. Without a usable cost of goods, without a fresh
 * verified shipping quote for every free shipping market, or without a usable
 * exchange rate, the variant is held and nothing is written. Every write is
 * idempotent: recalculating an unchanged variant produces the same price, so
 * our own write echoing back through the store webhook settles as in sync
 * instead of triggering another write. Every write is also read back from the
 * store before it is treated as done.
 */
import { intakeCredentials, shopifyGraphql } from "../services/shopify.server";
import { zendropAdminClient } from "../zendrop/client.server";
import { CANONICAL_FORMULA_VERSION } from "./canonical";
import { loadCanonicalPricingContext, loadShippingEvidenceForProducts, priceVariant } from "./canonical.server";
import { verifyReadbackParity } from "./readback";


export const PRICING_FORMULA_VERSION = CANONICAL_FORMULA_VERSION;


/** A penny. Prices equal within this are the same price. */
const PENCE = 0.005;

/** Retry spacing for a variant the store refused. Bounded and predictable. */
const BACKOFF_MINUTES = [5, 30, 180, 720];

/** Checkpoint identifier for the resumable pass over the catalogue. */
const PRICE_CHECKPOINT = "price_authority";

const PRODUCT_PRICING_QUERY = `
  query NurGoodsProductPricing($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        title
        status
        variants(first: 100) {
          nodes {
            id
            title
            price
            compareAtPrice
            inventoryItem { unitCost { amount currencyCode } }
          }
        }
      }
    }
  }
`;

const VARIANT_PRICE_MUTATION = `
  mutation NurGoodsAuthorityPrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id price compareAtPrice }
      userErrors { field message }
    }
  }
`;

export interface RepriceResult {
  products: number;
  variants: number;
  inSync: number;
  repriced: number;
  held: number;
  failed: number;
  compareAtCleared: number;
  examples: string[];
  message: string;
}

export interface PriceParityReport {
  ok: boolean;
  authorityRows: number;
  mirrorMismatches: number;
  snapshotMismatches: number;
  nonCharm: number;
  held: number;
  legacyRows: number;
  examples: string[];
  message: string;
}

/**
 * The key that makes a push repeatable. Retrying the same variant at the same
 * price is a no-op rather than a second change.
 */
function idempotencyKey(variantId: string, price: number): string {
  return `${variantId}:${price.toFixed(2)}:${PRICING_FORMULA_VERSION}`;
}

function nextAttemptAt(attempts: number): string {
  const minutes = BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length - 1)] ?? 720;
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

/**
 * The pricing input fingerprint now lives in canonical.ts, because it has to
 * cover the shipping evidence as well as the cost of goods. A quote that moves,
 * expires or changes destination changes the fingerprint and forces a reprice.
 */


function numeric(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function readCheckpoint(supabase: any, id: string): Promise<string | null> {
  const { data } = await supabase
    .from("pricing_backfill_state")
    .select("cursor")
    .eq("id", id)
    .maybeSingle();
  return (data as any)?.cursor ?? null;
}

async function writeCheckpoint(
  supabase: any,
  id: string,
  cursor: string | null,
  counters: { seen?: number; priced?: number; held?: number } = {},
): Promise<void> {
  await supabase.from("pricing_backfill_state").upsert(
    {
      id,
      cursor,
      variants_seen: counters.seen ?? 0,
      variants_priced: counters.priced ?? 0,
      variants_held: counters.held ?? 0,
      completed_at: cursor === null ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: "id" },
  );
}


/**
 * Reprices a bounded set of store products. Reads cost of goods straight from
 * the store, calculates the NUR GOODS price, writes it back when it differs,
 * and records the calculation, the observation and the outcome for every
 * variant. Drafts are priced too, so a product is correct before it goes live.
 *
 * Imported compare-at prices are cleared alongside the price. Supplier
 * compare-at values are not evidenced promotions and would be misleading.
 */
export async function repriceProducts(options: {
  shopifyProductIds: string[];
  dryRun?: boolean;
}): Promise<RepriceResult> {
  const ids = Array.from(new Set(options.shopifyProductIds.filter(Boolean)));
  const dryRun = options.dryRun === true;
  const result: RepriceResult = {
    products: 0,
    variants: 0,
    inSync: 0,
    repriced: 0,
    held: 0,
    failed: 0,
    compareAtCleared: 0,
    examples: [],
    message: "",
  };
  if (ids.length === 0) {
    result.message = "There was nothing to reprice.";
    return result;
  }

  const supabase = await zendropAdminClient();
  const context = await loadCanonicalPricingContext();
  const evidenceByProduct = await loadShippingEvidenceForProducts(ids);

  const credentials = await intakeCredentials();

  const { data: mirrorRows } = await supabase
    .from("shopify_products")
    .select("id, shopify_product_id")
    .in("shopify_product_id", ids);
  const mirrorIdByShopifyId = new Map<string, string>(
    ((mirrorRows ?? []) as any[]).map((row) => [String(row.shopify_product_id), String(row.id)]),
  );

  for (let start = 0; start < ids.length; start += 20) {
    const batch = ids.slice(start, start + 20);
    const data: any = await shopifyGraphql(credentials, PRODUCT_PRICING_QUERY, { ids: batch });
    const products = ((data?.nodes ?? []) as any[]).filter((node) => node?.id);

    for (const product of products) {
      result.products += 1;
      const shopifyProductId = String(product.id);
      const mirrorProductId = mirrorIdByShopifyId.get(shopifyProductId) ?? null;
      // Shipping is quoted per product and per destination, so the same
      // evidence covers every variant of the product.
      const quotes = evidenceByProduct.get(shopifyProductId) ?? [];
      const now = new Date().toISOString();
      const changes: Array<{ id: string; price: string; compareAtPrice: null }> = [];
      const rowsToWrite: Array<{ row: Record<string, unknown>; expected: number | null }> = [];

      for (const variant of (product.variants?.nodes ?? []) as any[]) {
        result.variants += 1;
        const variantId = String(variant.id);
        const observed = numeric(variant.price);
        const compareAt = numeric(variant.compareAtPrice);
        const unitCostRaw = numeric(variant?.inventoryItem?.unitCost?.amount);
        const costCurrency = variant?.inventoryItem?.unitCost?.currencyCode ?? null;

        const priced = priceVariant({
          context,
          itemCost: unitCostRaw,
          itemCostCurrency: costCurrency,
          quotes,
        });

        const hold = priced.complete ? null : priced.reason;
        const expected = priced.price;

        const row: Record<string, unknown> = {
          product_id: mirrorProductId,
          shopify_product_id: shopifyProductId,
          shopify_variant_id: variantId,
          variant_title: variant.title ?? null,
          currency: context.sellingCurrency,
          authority_source: "nur_goods_calculated",
          formula_version: PRICING_FORMULA_VERSION,
          formula_inputs: {
            unit_cost: unitCostRaw,
            cost_source: "store_inventory_unit_cost",
            markup_uplift: priced.markupUplift,
            fee_variable: context.fee.variable,
            fee_fixed: context.fee.fixed,
            fx_buffer_pct: context.fxBufferPct,
            fx_reference_rates: context.referenceFxRates,
            fx_as_of: context.fxAsOf,
            fx_source: context.fxSource,
            required_markets: context.requiredMarkets,
            markets: priced.markets,
            worst_market: priced.worstMarket,
            protected_landed_cost: priced.protectedLandedCost,
            raw_price: priced.rawPrice,
            target_revenue: priced.targetRevenue,
            expected_profit: priced.expectedProfit,
            realised_markup: priced.realisedMarkup,
            hold_status: priced.status,
            rounding_mode: "charm_99",
          },
          unit_cost: unitCostRaw,
          cost_observed_at: unitCostRaw === null ? null : now,
          input_hash: priced.fingerprint,
          // The landed cost recorded here is the one the price had to cover,
          // never the bare item cost.
          landed_cost: priced.protectedLandedCost,
          landed_cost_verified_at: hold ? null : now,
          cost_source: unitCostRaw === null ? null : "store_inventory_unit_cost",
          expected_price: expected,
          observed_shopify_price: observed,
          observed_at: now,
          hold_reason: hold,
        };


        if (hold) {
          result.held += 1;
          row["push_state"] = "held";
          row["drift_detected_at"] = null;
          rowsToWrite.push({ row, expected: null });
          continue;
        }

        const priceDrift = observed === null || Math.abs(observed - expected!) >= PENCE;
        const compareAtDrift = compareAt !== null;
        if (priceDrift || compareAtDrift) {
          if (compareAtDrift) result.compareAtCleared += 1;
          row["push_state"] = "drifted";
          row["drift_detected_at"] = now;
          row["idempotency_key"] = idempotencyKey(variantId, expected!);
          row["next_attempt_at"] = now;
          row["push_attempts"] = 0;
          row["last_push_error"] = null;
          if (result.examples.length < 12) {
            result.examples.push(
              `${product.title ?? shopifyProductId} ${variant.title ?? ""}: cost ${unitCostRaw}, store ${observed ?? "none"} -> ${expected!.toFixed(2)}`,
            );
          }
          if (!dryRun) {
            changes.push({ id: variantId, price: expected!.toFixed(2), compareAtPrice: null });
          }
          rowsToWrite.push({ row, expected });
        } else {
          result.inSync += 1;
          row["push_state"] = "in_sync";
          row["drift_detected_at"] = null;
          row["hold_reason"] = null;
          row["last_push_error"] = null;
          row["next_attempt_at"] = null;
          rowsToWrite.push({ row, expected });
        }
      }

      if (dryRun) {
        result.repriced += rowsToWrite.filter((entry) => entry.row["push_state"] === "drifted").length;
        continue;
      }

      let failure: string | null = null;
      if (changes.length > 0) {
        try {
          // The store client already backs off and retries on rate limiting.
          const response: any = await shopifyGraphql(credentials, VARIANT_PRICE_MUTATION, {
            productId: shopifyProductId,
            variants: changes,
          });
          const errors = response?.productVariantsBulkUpdate?.userErrors ?? [];
          if (errors.length > 0) failure = errors.map((e: any) => e.message).join(" ");
        } catch (cause) {
          failure = cause instanceof Error ? cause.message : "The store rejected the price update";
        }
      }

      // A mutation that returned without an error is not proof. The store is
      // read back and the price we intended must be the price it now holds,
      // ending .99, with no unverified compare-at left behind. Anything else
      // is a failed push, not a success.
      let readbackProblems = new Map<string, string>();
      if (changes.length > 0 && !failure) {
        try {
          const confirm: any = await shopifyGraphql(credentials, PRODUCT_PRICING_QUERY, {
            ids: [shopifyProductId],
          });
          const node = ((confirm?.nodes ?? []) as any[]).find((entry) => entry?.id);
          const stored = new Map<string, { price: number | null; compareAt: number | null }>(
            ((node?.variants?.nodes ?? []) as any[]).map((entry) => [
              String(entry.id),
              { price: numeric(entry.price), compareAt: numeric(entry.compareAtPrice) },
            ]),
          );
          readbackProblems = verifyReadbackParity(changes, stored);
        } catch (cause) {
          failure = cause instanceof Error ? cause.message : "The written price could not be read back";
        }
      }


      for (const entry of rowsToWrite) {
        const row = entry.row;
        const wasDrift = row["push_state"] === "drifted";
        const readbackProblem = wasDrift
          ? (readbackProblems.get(String(row["shopify_variant_id"])) ?? null)
          : null;
        if (wasDrift && (failure || readbackProblem)) {
          result.failed += 1;
          row["push_state"] = "failed";
          row["push_attempts"] = 1;
          row["last_push_status"] = "failed";
          row["last_push_error"] = String(failure ?? readbackProblem).slice(0, 500);
          row["next_attempt_at"] = nextAttemptAt(1);
        } else if (wasDrift) {

          result.repriced += 1;
          row["push_state"] = "in_sync";
          row["observed_shopify_price"] = entry.expected;
          row["drift_detected_at"] = null;
          row["last_pushed_at"] = new Date().toISOString();
          row["last_push_status"] = "succeeded";
          row["last_push_error"] = null;
          row["push_attempts"] = 0;
          row["next_attempt_at"] = null;
          // The mirror is corrected in the same breath so the store webhook
          // echoing this change back is recognised as our own.
          await supabase
            .from("shopify_product_variants")
            .update({
              price: entry.expected,
              compare_at_price: null,
              unit_cost: row["unit_cost"],
              unit_cost_currency: context.sellingCurrency,
              cost_source: row["cost_source"],
              cost_synced_at: now,
            } as never)
            .eq("shopify_variant_id", String(row["shopify_variant_id"]));
        } else {
          await supabase
            .from("shopify_product_variants")
            .update({
              unit_cost: row["unit_cost"],
              cost_source: row["cost_source"],
              cost_synced_at: now,
            } as never)
            .eq("shopify_variant_id", String(row["shopify_variant_id"]));
        }

        await supabase
          .from("product_price_authority")
          .upsert(row as never, { onConflict: "shopify_variant_id" });
      }

      if (mirrorProductId && !failure) {
        const { data: variants } = await supabase
          .from("shopify_product_variants")
          .select("price")
          .eq("product_id", mirrorProductId);
        const prices = ((variants ?? []) as any[])
          .map((entry) => Number(entry.price))
          .filter((value) => Number.isFinite(value));
        if (prices.length > 0) {
          await supabase
            .from("shopify_products")
            .update({ price_min: Math.min(...prices), price_max: Math.max(...prices) } as never)
            .eq("id", mirrorProductId);
        }
      }
    }
  }

  result.message = dryRun
    ? `${result.variants} variant(s) measured across ${result.products} product(s): ${result.inSync} already correct, ${result.repriced} would change, ${result.held} held for unverified landed cost.`
    : `${result.variants} variant(s) across ${result.products} product(s): ${result.repriced} repriced, ${result.inSync} already correct, ${result.held} held for unverified landed cost, ${result.failed} failed and scheduled for retry.`;
  return result;
}

/**
 * Repricing triggered by a store product event. Small, bounded and safe to
 * call from the intake worker after a product has been mirrored.
 */
export async function repriceProductsFromWebhook(shopifyProductIds: string[]): Promise<RepriceResult> {
  return repriceProducts({ shopifyProductIds: shopifyProductIds.slice(0, 20) });
}

/** A bounded, resumable page of the catalogue, drafts included. */
async function nextProductPage(
  supabase: any,
  limit: number,
): Promise<{ ids: string[]; cursor: string | null; finished: boolean }> {
  const cursor = (await readCheckpoint(supabase, PRICE_CHECKPOINT)) ?? "";
  const { data } = await supabase
    .from("shopify_products")
    .select("shopify_product_id")
    .gt("shopify_product_id", cursor)
    .order("shopify_product_id", { ascending: true })
    .limit(limit);
  const ids = ((data ?? []) as any[]).map((row) => String(row.shopify_product_id));
  const finished = ids.length < limit;
  return { ids, cursor: finished ? null : (ids[ids.length - 1] ?? null), finished };
}

/**
 * One pass of the pricing worker: take the next bounded page of the catalogue,
 * recalculate it, correct the store where it differs, then report parity.
 */
export async function runPriceAuthorityCycle(options: { pushLimit?: number } = {}) {
  const supabase = await zendropAdminClient();
  const products = Math.max(5, Math.min(options.pushLimit ?? 30, 60));
  const page = await nextProductPage(supabase, products);
  const reprice = await repriceProducts({ shopifyProductIds: page.ids });
  await writeCheckpoint(supabase, PRICE_CHECKPOINT, page.cursor, {
    seen: reprice.variants,
    priced: reprice.repriced + reprice.inSync,
    held: reprice.held,
  });
  if (page.finished) {
    await supabase
      .from("pricing_backfill_state")
      .update({ cursor: "" } as never)
      .eq("id", PRICE_CHECKPOINT);
  }
  const parity = await verifyPriceParity();
  return { reprice, parity, finishedFullPass: page.finished };
}

/**
 * Confirms the same price is showing everywhere a customer can see it: the
 * calculated authority, the store variant mirror that feeds the Online Store,
 * the Shop channel and checkout, and the storefront projection the website
 * renders from.
 */
export async function verifyPriceParity(): Promise<PriceParityReport> {
  const supabase = await zendropAdminClient();

  const { data: authority } = await supabase
    .from("product_price_authority")
    .select(
      "product_id, shopify_variant_id, variant_title, expected_price, observed_shopify_price, push_state, hold_reason, formula_version",
    );
  const rows = (authority ?? []) as any[];

  const { data: snapshot } = await supabase
    .from("storefront_snapshot")
    .select("product_id, price_min, price_max");
  const snapshotByProduct = new Map(
    ((snapshot ?? []) as any[]).map((row) => [String(row.product_id), row]),
  );

  const report: PriceParityReport = {
    ok: true,
    authorityRows: rows.length,
    mirrorMismatches: 0,
    snapshotMismatches: 0,
    nonCharm: 0,
    held: 0,
    legacyRows: 0,
    examples: [],
    message: "",
  };

  for (const row of rows) {
    if (row.formula_version !== PRICING_FORMULA_VERSION) report.legacyRows += 1;
    if (row.hold_reason) {
      report.held += 1;
      continue;
    }
    const expected = row.expected_price === null ? null : Number(row.expected_price);
    if (expected === null) continue;

    if (Math.round(expected * 100) % 100 !== 99) {
      report.nonCharm += 1;
      if (report.examples.length < 10)
        report.examples.push(`${row.shopify_variant_id} is priced ${expected.toFixed(2)}`);
    }

    const observed =
      row.observed_shopify_price === null ? null : Number(row.observed_shopify_price);
    if (observed === null || Math.abs(observed - expected) >= PENCE) {
      report.mirrorMismatches += 1;
      if (report.examples.length < 10)
        report.examples.push(
          `${row.shopify_variant_id}: store shows ${observed ?? "nothing"}, NUR GOODS price ${expected.toFixed(2)}`,
        );
    }

    const projected = snapshotByProduct.get(String(row.product_id));
    if (projected) {
      const min = Number(projected.price_min);
      const max = Number(projected.price_max);
      if (Number.isFinite(min) && Number.isFinite(max) && (expected < min - PENCE || expected > max + PENCE)) {
        report.snapshotMismatches += 1;
      }
    }
  }

  report.ok =
    report.mirrorMismatches === 0 &&
    report.snapshotMismatches === 0 &&
    report.nonCharm === 0 &&
    report.legacyRows === 0;
  report.message = report.ok
    ? `Price parity confirmed across ${report.authorityRows} variant record(s). ${report.held} held pending verified cost.`
    : `${report.mirrorMismatches} store mismatch(es), ${report.snapshotMismatches} storefront mismatch(es), ${report.nonCharm} price(s) not ending .99 and ${report.legacyRows} record(s) on a superseded formula across ${report.authorityRows} variant record(s).`;
  return report;
}
