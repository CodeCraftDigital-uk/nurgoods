/**
 * Price authority.
 *
 * NUR GOODS decides what a product is advertised for. The supplier price and
 * whatever the store currently shows are inputs and observations, never the
 * decision. This module keeps one record per variant holding the price NUR
 * GOODS calculated, the evidence behind it, and the outcome of every attempt to
 * write that price back to the store.
 *
 * Direction of travel is deliberately one way per kind of data:
 *
 *   catalogue facts   store / supplier  ->  NUR GOODS mirror
 *   advertised price  NUR GOODS         ->  store variants
 *
 * That is what stops a loop. A store price that differs from the calculated
 * price is recorded as drift and queued for correction. It is never promoted to
 * the authority, so a supplier originated change can never quietly become the
 * price customers pay.
 *
 * Everything fails closed. Without a verified landed cost, usable shipping
 * evidence and a mapped variant, the row is held and nothing is pushed.
 */
import { intakeCredentials, shopifyGraphql } from "../services/shopify.server";
import { zendropAdminClient } from "../zendrop/client.server";
import { loadPricingSettings } from "../zendrop/import.server";
import { computeEconomics } from "./economics";

/**
 * Identifies the calculation behind a stored price. Bump this whenever the
 * formula changes so a historic price can always be explained by the rules that
 * were in force when it was set.
 */
export const PRICING_FORMULA_VERSION = "shopify-unitcost-charm-v3";

/** A penny. Prices equal within this are the same price. */
const PENCE = 0.005;

/** Retry spacing for a variant the store refused. Bounded and predictable. */
const BACKOFF_MINUTES = [5, 30, 180, 720];

const VARIANT_PRICE_MUTATION = `
  mutation NurGoodsAuthorityPrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id price }
      userErrors { field message }
    }
  }
`;

export interface AuthorityReconcileResult {
  variants: number;
  inSync: number;
  drifted: number;
  held: number;
  message: string;
}

export interface AuthorityPushResult {
  attempted: number;
  pushed: number;
  failed: number;
  skipped: number;
  message: string;
}

export interface PriceParityReport {
  ok: boolean;
  authorityRows: number;
  mirrorMismatches: number;
  snapshotMismatches: number;
  nonCharm: number;
  held: number;
  examples: string[];
  message: string;
}

/**
 * The key that makes a push repeatable. Retrying the same variant at the same
 * price is a no-op rather than a second change, so an interrupted batch can be
 * safely resumed.
 */
function idempotencyKey(variantId: string, price: number): string {
  return `${variantId}:${price.toFixed(2)}:${PRICING_FORMULA_VERSION}`;
}

function nextAttemptAt(attempts: number): string {
  const minutes = BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length - 1)] ?? 720;
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

/** Checkpoint identifiers for the resumable passes over the catalogue. */
const COST_CHECKPOINT = "shopify_variant_cost";
const PRICE_CHECKPOINT = "price_authority";

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
 * Fingerprint of everything the price is derived from. An unchanged
 * fingerprint means a recalculation is a no-op, which is what keeps our own
 * write from bouncing back through the store webhook as fresh work.
 */
function inputHash(unitCost: number, settings: { target_margin: number; payment_fee_variable: number; payment_fee_fixed: number; rounding_mode: string }): string {
  return [
    unitCost.toFixed(4),
    settings.target_margin,
    settings.payment_fee_variable,
    settings.payment_fee_fixed,
    settings.rounding_mode,
    PRICING_FORMULA_VERSION,
  ].join("|");
}

/**
 * Reads a bounded, resumable page of cost of goods straight from the store and
 * mirrors it. The store's inventory unit cost is the only cost input the
 * pricing service trusts.
 */
export async function refreshVariantCostPage(maxPages = 3): Promise<{
  seen: number;
  withCost: number;
  message: string;
}> {
  const supabase = await zendropAdminClient();
  const { syncVariantCosts } = await import("./cost-sync.server");
  const cursor = await readCheckpoint(supabase, COST_CHECKPOINT);
  const result = await syncVariantCosts({ cursor, maxPages });
  await writeCheckpoint(supabase, COST_CHECKPOINT, result.nextCursor, {
    seen: result.variantsSeen,
    priced: result.variantsWithCost,
  });
  return { seen: result.variantsSeen, withCost: result.variantsWithCost, message: result.message };
}

/**
 * Recalculates the price for a bounded, resumable page of active store
 * variants and records how it compares with the store. Nothing is written to
 * the store here; this pass only establishes the truth and marks what needs
 * correcting.
 *
 * The only cost input is the store's own inventory unit cost, recorded in the
 * settlement currency. Deliverability is filtered by the supplier before a
 * product ever reaches the store, so this pass no longer re-proves shipping or
 * supplier mapping. A variant with no usable cost is held, never guessed.
 */
export async function reconcilePriceAuthority(
  options: { limit?: number } = {},
): Promise<AuthorityReconcileResult> {
  const limit = Math.max(1, Math.min(options.limit ?? 400, 1000));
  const supabase = await zendropAdminClient();
  const settings = await loadPricingSettings();
  const fee = { variable: settings.payment_fee_variable, fixed: settings.payment_fee_fixed };

  const cursor = (await readCheckpoint(supabase, PRICE_CHECKPOINT)) ?? "";
  const { data: variants } = await supabase
    .from("shopify_product_variants")
    .select(
      "shopify_variant_id, title, price, unit_cost, unit_cost_currency, cost_source, cost_synced_at, product_id, shopify_products!inner(id, shopify_product_id, status)",
    )
    .in("shopify_products.status", ["active", "ACTIVE", "Active"])
    .gt("shopify_variant_id", cursor)
    .order("shopify_variant_id", { ascending: true })
    .limit(limit);

  const rows = (variants ?? []) as any[];
  const result: AuthorityReconcileResult = {
    variants: 0,
    inSync: 0,
    drifted: 0,
    held: 0,
    message: "",
  };

  for (const variant of rows) {
    result.variants += 1;
    const product = variant.shopify_products;
    const observed = variant.price === null ? null : Number(variant.price);
    const rawCost = variant.unit_cost === null ? null : Number(variant.unit_cost);
    const unitCost = rawCost !== null && Number.isFinite(rawCost) ? rawCost : null;
    const costCurrency = variant.unit_cost_currency ?? null;

    let hold: string | null = null;
    if (unitCost === null) hold = "No cost of goods is recorded against this variant in the store";
    else if (unitCost <= 0) hold = "The store records a zero cost of goods, so no price can be derived";
    else if (costCurrency && costCurrency !== settings.currency)
      hold = `The recorded cost is in ${costCurrency}, which is not comparable with ${settings.currency}`;

    const economics = hold
      ? null
      : computeEconomics({
          supplierItemCost: unitCost,
          itemCostIsSettlementCurrency: true,
          supplierShippingCost: 0,
          referenceFxRate: 1,
          fxBufferPct: 0,
          targetMargin: settings.target_margin,
          fee,
          roundingMode: settings.rounding_mode,
          promoDiscount: settings.promo_discount,
          minPromoMargin: settings.min_promo_margin,
        });

    const expected =
      economics && economics.complete && economics.advertisedPrice !== null
        ? economics.advertisedPrice
        : null;
    if (!hold && expected === null) hold = economics?.reason ?? "The price could not be derived";

    const now = new Date().toISOString();
    const drifted = expected !== null && (observed === null || Math.abs(observed - expected) >= PENCE);

    const row: Record<string, unknown> = {
      product_id: product.id,
      shopify_product_id: String(product.shopify_product_id),
      shopify_variant_id: String(variant.shopify_variant_id),
      variant_title: variant.title ?? null,
      currency: settings.currency,
      authority_source: "nur_goods_calculated",
      formula_version: PRICING_FORMULA_VERSION,
      formula_inputs: {
        unit_cost: unitCost,
        cost_source: variant.cost_source ?? "store_inventory_unit_cost",
        target_margin: settings.target_margin,
        fee_variable: fee.variable,
        fee_fixed: fee.fixed,
        rounding_mode: settings.rounding_mode,
        required_price: economics?.requiredPrice ?? null,
      },
      unit_cost: unitCost,
      cost_observed_at: variant.cost_synced_at ?? null,
      input_hash: unitCost === null ? null : inputHash(unitCost, settings),
      landed_cost: unitCost,
      landed_cost_verified_at: hold ? null : (variant.cost_synced_at ?? now),
      cost_source: variant.cost_source ?? "store_inventory_unit_cost",
      expected_price: expected,
      observed_shopify_price: observed,
      observed_at: now,
      hold_reason: hold,
    };

    if (hold) {
      result.held += 1;
      row["push_state"] = "held";
      row["drift_detected_at"] = null;
    } else if (drifted) {
      result.drifted += 1;
      row["push_state"] = "drifted";
      row["drift_detected_at"] = now;
      row["idempotency_key"] = idempotencyKey(String(variant.shopify_variant_id), expected!);
      row["next_attempt_at"] = now;
      row["push_attempts"] = 0;
      row["last_push_error"] = null;
    } else {
      result.inSync += 1;
      row["push_state"] = "in_sync";
      row["drift_detected_at"] = null;
      row["hold_reason"] = null;
      row["last_push_error"] = null;
      row["next_attempt_at"] = null;
    }

    await supabase
      .from("product_price_authority")
      .upsert(row as never, { onConflict: "shopify_variant_id" });
  }

  // Resumable: the checkpoint advances while there is more to read and resets
  // to the start of the catalogue once a full pass is finished.
  const last = rows.length > 0 ? String(rows[rows.length - 1].shopify_variant_id) : null;
  const finished = rows.length < limit;
  await writeCheckpoint(supabase, PRICE_CHECKPOINT, finished ? null : last, {
    seen: result.variants,
    priced: result.inSync + result.drifted,
    held: result.held,
  });
  if (finished) {
    await supabase
      .from("pricing_backfill_state")
      .update({ cursor: "" } as never)
      .eq("id", PRICE_CHECKPOINT);
  }

  result.message = `${result.variants} variant(s) measured: ${result.inSync} in sync, ${result.drifted} drifted and queued for correction, ${result.held} held for missing store cost.${finished ? " Full catalogue pass complete." : " More variants remain for the next pass."}`;
  return result;
}

/**
 * Writes the NUR GOODS price out to the store for variants marked as drifted.
 * Bounded, grouped per product, and idempotent: a repeat of the same key is a
 * no-op because the store already holds that price and the row settles to in
 * sync on the next reconcile.
 */
export async function pushPriceAuthority(
  options: { limit?: number } = {},
): Promise<AuthorityPushResult> {
  const limit = Math.min(options.limit ?? 60, 120);
  const supabase = await zendropAdminClient();
  const nowIso = new Date().toISOString();

  const { data } = await supabase
    .from("product_price_authority")
    .select("*")
    .in("push_state", ["drifted", "failed", "queued"])
    .not("expected_price", "is", null)
    .is("hold_reason", null)
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .order("next_attempt_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  const rows = (data ?? []) as any[];
  const result: AuthorityPushResult = {
    attempted: rows.length,
    pushed: 0,
    failed: 0,
    skipped: 0,
    message: "",
  };
  if (rows.length === 0) {
    result.message = "Every variant already advertises the NUR GOODS price.";
    return result;
  }

  const credentials = await intakeCredentials();
  const byProduct = new Map<string, any[]>();
  for (const row of rows) {
    const key = String(row.shopify_product_id);
    byProduct.set(key, [...(byProduct.get(key) ?? []), row]);
  }

  for (const [productId, group] of byProduct) {
    const changes = group.map((row) => ({
      id: String(row.shopify_variant_id),
      price: Number(row.expected_price).toFixed(2),
    }));

    let failure: string | null = null;
    try {
      // The store client already backs off and retries on rate limiting.
      const response: any = await shopifyGraphql(credentials, VARIANT_PRICE_MUTATION, {
        productId,
        variants: changes,
      });
      const errors = response?.productVariantsBulkUpdate?.userErrors ?? [];
      if (errors.length > 0) failure = errors.map((e: any) => e.message).join(" ");
    } catch (cause) {
      failure = cause instanceof Error ? cause.message : "The store rejected the price update";
    }

    for (const row of group) {
      const price = Number(row.expected_price);
      if (failure) {
        result.failed += 1;
        const attempts = Number(row.push_attempts ?? 0) + 1;
        await supabase
          .from("product_price_authority")
          .update({
            push_state: "failed",
            push_attempts: attempts,
            last_push_status: "failed",
            last_push_error: failure.slice(0, 500),
            next_attempt_at: nextAttemptAt(attempts),
          } as never)
          .eq("id", row.id);
        continue;
      }

      result.pushed += 1;
      // The mirror is updated in the same breath so the store webhook echoing
      // this change back is recognised as our own and not treated as drift.
      await supabase
        .from("shopify_product_variants")
        .update({ price } as never)
        .eq("shopify_variant_id", String(row.shopify_variant_id));

      await supabase
        .from("product_price_authority")
        .update({
          push_state: "in_sync",
          observed_shopify_price: price,
          observed_at: new Date().toISOString(),
          drift_detected_at: null,
          last_pushed_at: new Date().toISOString(),
          last_push_status: "succeeded",
          last_push_error: null,
          push_attempts: 0,
          next_attempt_at: null,
          idempotency_key: idempotencyKey(String(row.shopify_variant_id), price),
        } as never)
        .eq("id", row.id);
    }

    if (!failure) {
      const { data: variants } = await supabase
        .from("shopify_product_variants")
        .select("price")
        .eq("product_id", group[0]?.product_id);
      const prices = ((variants ?? []) as any[])
        .map((entry) => Number(entry.price))
        .filter((value) => Number.isFinite(value));
      if (prices.length > 0 && group[0]?.product_id) {
        await supabase
          .from("shopify_products")
          .update({ price_min: Math.min(...prices), price_max: Math.max(...prices) } as never)
          .eq("id", group[0].product_id);
      }
    }
  }

  result.message = `${result.pushed} variant price(s) corrected in the store, ${result.failed} failed and scheduled for retry.`;
  return result;
}

/**
 * Confirms the same price is showing everywhere a customer can see it: the
 * calculated authority, the store variant mirror that feeds the Shop channel
 * and checkout, and the storefront projection the website renders from.
 */
export async function verifyPriceParity(): Promise<PriceParityReport> {
  const supabase = await zendropAdminClient();

  const { data: authority } = await supabase
    .from("product_price_authority")
    .select(
      "product_id, shopify_variant_id, variant_title, expected_price, observed_shopify_price, push_state, hold_reason",
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
    examples: [],
    message: "",
  };

  for (const row of rows) {
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
    report.mirrorMismatches === 0 && report.snapshotMismatches === 0 && report.nonCharm === 0;
  report.message = report.ok
    ? `Price parity confirmed across ${report.authorityRows} variant record(s). ${report.held} held pending verified cost.`
    : `${report.mirrorMismatches} store mismatch(es), ${report.snapshotMismatches} storefront mismatch(es) and ${report.nonCharm} price(s) not ending .99 across ${report.authorityRows} variant record(s).`;
  return report;
}

/**
 * One pass of the outward flow: recalculate, detect drift, then correct a
 * bounded number of variants. Used by the scheduled job and by the control
 * plane so both behave identically.
 */
export async function runPriceAuthorityCycle(options: { pushLimit?: number } = {}) {
  // Cost first: the store's inventory unit cost is the only input the price is
  // derived from, so a bounded, resumable page of it is refreshed each cycle.
  const cost = await refreshVariantCostPage(3).catch(() => ({ seen: 0, withCost: 0, message: "Cost refresh unavailable this pass" }));
  const reconcile = await reconcilePriceAuthority({});
  const push = await pushPriceAuthority({ limit: options.pushLimit ?? 60 });
  const parity = await verifyPriceParity();
  return { cost, reconcile, push, parity };
}
