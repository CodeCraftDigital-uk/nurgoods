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
import { getFxRate, type FxQuote } from "../zendrop/fx.server";
import { computeEconomics } from "./economics";
import { assessShippingEvidence } from "./shipping-evidence";
import { loadShippingBasis, type ShippingBasis } from "./audit.server";

/**
 * Identifies the calculation behind a stored price. Bump this whenever the
 * formula changes so a historic price can always be explained by the rules that
 * were in force when it was set.
 */
export const PRICING_FORMULA_VERSION = "landed-cogs-charm-v2";

/** A penny. Prices equal within this are the same price. */
const PENCE = 0.005;

/** Retry spacing for a variant the store refused. Bounded and predictable. */
const BACKOFF_MINUTES = [5, 30, 180, 720];

const UNLINKED: ShippingBasis = {
  amount: null,
  currency: null,
  service: null,
  destination: null,
  quotedAt: null,
  source: null,
  linked: false,
};

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

/**
 * Recalculates the authoritative price for every active variant and records how
 * it compares with the store. Nothing is written to the store here; this pass
 * only establishes the truth and marks what needs correcting.
 */
export async function reconcilePriceAuthority(
  options: { limit?: number } = {},
): Promise<AuthorityReconcileResult> {
  const limit = options.limit ?? 400;
  const supabase = await zendropAdminClient();
  const settings = await loadPricingSettings();
  const shipping = await loadShippingBasis();

  let fx: FxQuote | null = null;
  let fxProblem: string | null = null;
  try {
    fx = await getFxRate("USD", settings.currency);
    const ageHours = (Date.now() - new Date(`${fx.asOf}T00:00:00Z`).getTime()) / 3_600_000;
    if (Number.isFinite(ageHours) && ageHours > settings.fx_quote_max_age_hours) {
      fxProblem = `The reference exchange rate is dated ${fx.asOf}, older than the freshness policy`;
      fx = null;
    }
  } catch (cause) {
    fxProblem = cause instanceof Error ? cause.message : "No reference exchange rate is available";
  }

  const { data: products } = await supabase
    .from("shopify_products")
    .select("id, shopify_product_id, title, status, currency")
    .eq("status", "ACTIVE")
    .order("updated_at", { ascending: true })
    .limit(limit);

  const fee = { variable: settings.payment_fee_variable, fixed: settings.payment_fee_fixed };
  const result: AuthorityReconcileResult = {
    variants: 0,
    inSync: 0,
    drifted: 0,
    held: 0,
    message: "",
  };

  for (const product of ((products ?? []) as any[])) {
    const basis =
      shipping.get(String(product.shopify_product_id)) ??
      shipping.get(`uuid:${product.id}`) ??
      UNLINKED;
    const evidence = assessShippingEvidence(
      {
        amount: basis.amount,
        currency: basis.currency,
        destination: basis.destination,
        service: basis.service,
        quotedAt: basis.quotedAt,
      },
      { market: settings.shipping_market, maxAgeDays: settings.shipping_quote_max_age_days },
    );

    const { data: variants } = await supabase
      .from("shopify_product_variants")
      .select("shopify_variant_id, title, price, unit_cost, unit_cost_currency, cost_source")
      .eq("product_id", product.id);

    for (const variant of ((variants ?? []) as any[])) {
      result.variants += 1;
      const observed = variant.price === null ? null : Number(variant.price);
      const unitCost = variant.unit_cost === null ? null : Number(variant.unit_cost);
      const costCurrency = variant.unit_cost_currency ?? null;

      let hold: string | null = null;
      if (!basis.linked) hold = "No verified supplier linkage, so the landed cost is unproven";
      else if (unitCost === null) hold = "No cost of goods is recorded against this variant";
      else if (costCurrency && costCurrency !== settings.currency)
        hold = `The recorded cost is in ${costCurrency}, which is not comparable with ${settings.currency}`;
      else if (!evidence.usable) hold = evidence.reason;
      else if (!fx) hold = fxProblem ?? "No usable reference exchange rate";

      const economics = hold
        ? null
        : computeEconomics({
            supplierItemCost: unitCost,
            itemCostIsSettlementCurrency: true,
            supplierShippingCost: evidence.amount,
            referenceFxRate: fx!.rate,
            fxBufferPct: settings.fx_buffer_pct,
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
      const drifted =
        expected !== null && (observed === null || Math.abs(observed - expected) >= PENCE);

      const row: Record<string, unknown> = {
        product_id: product.id,
        shopify_product_id: String(product.shopify_product_id),
        shopify_variant_id: String(variant.shopify_variant_id),
        variant_title: variant.title ?? null,
        currency: settings.currency,
        // The supplier price never becomes the authority. When the calculation
        // cannot be completed the row is held rather than reassigned.
        authority_source: "nur_goods_calculated",
        formula_version: PRICING_FORMULA_VERSION,
        formula_inputs: {
          unit_cost: unitCost,
          cost_source: variant.cost_source ?? null,
          shipping_cost: evidence.usable ? evidence.amount : null,
          shipping_service: basis.service,
          shipping_destination: basis.destination,
          fx_reference_rate: fx?.rate ?? null,
          fx_effective_rate: economics?.effectiveFxRate ?? null,
          fx_buffer_pct: settings.fx_buffer_pct,
          target_margin: settings.target_margin,
          fee_variable: fee.variable,
          fee_fixed: fee.fixed,
          rounding_mode: settings.rounding_mode,
          required_price: economics?.requiredPrice ?? null,
        },
        landed_cost: economics?.protectedLandedCogs ?? null,
        landed_cost_verified_at: hold ? null : (basis.quotedAt ?? now),
        cost_source: variant.cost_source ?? null,
        shipping_source: basis.source,
        shipping_quoted_at: basis.quotedAt,
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
  }

  result.message = `${result.variants} variant(s) measured: ${result.inSync} in sync, ${result.drifted} drifted and queued for correction, ${result.held} held for unverified cost or mapping.`;
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
  const reconcile = await reconcilePriceAuthority({});
  const push = await pushPriceAuthority({ limit: options.pushLimit ?? 60 });
  const parity = await verifyPriceParity();
  return { reconcile, push, parity };
}
