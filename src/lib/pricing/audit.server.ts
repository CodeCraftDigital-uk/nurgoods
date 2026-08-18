/**
 * Safe pricing audit for listings that already exist in the catalogue.
 *
 * The audit is a dry run. It classifies every active variant against the
 * configured economics and records the exact inputs it used, including where
 * each cost input came from. A variant is only ever marked ready to reprice
 * when a real cost of goods and a verified destination shipping quote are both
 * available, so no price is ever derived from an invented number.
 *
 *   landed cogs   = (supplier shipping + supplier extras) * protected fx rate
 *                   + supplier item cost already held in pounds
 *   required price = (landed cogs + fixed fee) / (1 - variable fee - margin)
 *   advertised     = required price, charm rounded upwards only
 */
import { zendropAdminClient } from "../zendrop/client.server";
import { loadPricingSettings } from "../zendrop/import.server";
import { getFxRate, type FxQuote } from "../zendrop/fx.server";
import { computeEconomics } from "./economics";
import { assessShippingEvidence, type ShippingEvidenceStatus } from "./shipping-evidence";
import type { AuditStatus, AuditTotals } from "./types";
import { AUDIT_STATUSES } from "./types";

const PENCE = 0.005;

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface ShippingBasis {
  amount: number | null;
  currency: string | null;
  service: string | null;
  destination: string | null;
  quotedAt: string | null;
  source: string | null;
  linked: boolean;
}

const UNLINKED: ShippingBasis = {
  amount: null,
  currency: null,
  service: null,
  destination: null,
  quotedAt: null,
  source: null,
  linked: false,
};

/**
 * Shipping may only come from a genuine destination specific supplier quote.
 * Listings that predate the supplier integration, or that only carry the old
 * generic catalogue shipping figure, are reported rather than given a stand in
 * number. That generic figure is exactly what understated the landed cost on
 * the first real order.
 */
export async function loadShippingBasis(): Promise<Map<string, ShippingBasis>> {
  const supabase = await zendropAdminClient();
  const basis = new Map<string, ShippingBasis>();

  const record = (raw: any, entry: ShippingBasis) => {
    if (raw.shopify_product_id) basis.set(String(raw.shopify_product_id), entry);
    if (raw.product_id) basis.set(`uuid:${raw.product_id}`, entry);
  };

  // Legacy evidence first, so verified quotes always win.
  const { data: candidates } = await supabase
    .from("zendrop_import_candidates")
    .select("product_id, shopify_product_id, shipping_cost, currency, updated_at")
    .not("shopify_product_id", "is", null)
    .order("updated_at", { ascending: true });
  for (const raw of (candidates ?? []) as any[]) {
    const cost = raw.shipping_cost === null ? null : Number(raw.shipping_cost);
    record(raw, {
      amount: Number.isFinite(cost as number) ? (cost as number) : null,
      currency: raw.currency ?? null,
      // The legacy figure names neither a service nor a destination, so the
      // evidence policy will refuse it.
      service: null,
      destination: null,
      quotedAt: raw.updated_at ?? null,
      source: "legacy_catalogue_shipping_figure",
      linked: true,
    });
  }

  const { data: links } = await supabase
    .from("product_supplier_links")
    .select(
      "product_id, shopify_product_id, shipping_cost, shipping_currency, shipping_source, shipping_service, shipping_destination, shipping_quoted_at, quoted_amount, quoted_currency, match_confidence",
    )
    .eq("match_confidence", "high")
    .order("verified_at", { ascending: true });
  for (const raw of (links ?? []) as any[]) {
    const amount =
      raw.quoted_amount !== null && raw.quoted_amount !== undefined
        ? Number(raw.quoted_amount)
        : raw.shipping_cost === null
          ? null
          : Number(raw.shipping_cost);
    record(raw, {
      amount: Number.isFinite(amount as number) ? (amount as number) : null,
      currency: raw.quoted_currency ?? raw.shipping_currency ?? null,
      service: raw.shipping_service ?? null,
      destination: raw.shipping_destination ?? null,
      quotedAt: raw.shipping_quoted_at ?? null,
      source: raw.shipping_source ?? "supplier_destination_quote",
      linked: true,
    });
  }

  return basis;
}

async function loadSuppressedProductIds(): Promise<Set<string>> {
  const supabase = await zendropAdminClient();
  const { data } = await supabase
    .from("duplicate_group_members")
    .select("product_id")
    .eq("suppressed", true);
  return new Set(((data ?? []) as any[]).map((row) => String(row.product_id)));
}

export interface AuditRunSummary {
  runId: string;
  totals: AuditTotals;
  message: string;
}

function statusForEvidence(status: ShippingEvidenceStatus): AuditStatus {
  if (status === "missing") return "held_missing_uk_shipping";
  if (status === "stale") return "held_stale_shipping_quote";
  return "held_unreliable_linkage";
}

export async function runPricingAudit(userId: string | null): Promise<AuditRunSummary> {
  const supabase = await zendropAdminClient();
  const settings = await loadPricingSettings();
  const [shipping, suppressed] = await Promise.all([
    loadShippingBasis(),
    loadSuppressedProductIds(),
  ]);

  // The reference rate is fetched once per run so every line in the run is
  // measured on the same basis. A missing or stale rate stops the run rather
  // than letting pricing fall back to a guess.
  let fx: FxQuote | null = null;
  let fxProblem: string | null = null;
  try {
    fx = await getFxRate("USD", settings.currency);
    const ageHours = (Date.now() - new Date(`${fx.asOf}T00:00:00Z`).getTime()) / 3_600_000;
    if (Number.isFinite(ageHours) && ageHours > settings.fx_quote_max_age_hours) {
      fxProblem = `The reference exchange rate is dated ${fx.asOf}, which is older than the ${settings.fx_quote_max_age_hours} hour freshness policy`;
      fx = null;
    }
  } catch (cause) {
    fxProblem =
      cause instanceof Error ? cause.message : "The reference exchange rate could not be retrieved";
  }

  const { data: runRow, error: runError } = await supabase
    .from("pricing_audit_runs")
    .insert({
      mode: "preview",
      status: "running",
      settings: {
        ...settings,
        fx_reference_rate: fx?.rate ?? null,
        fx_as_of: fx?.asOf ?? null,
        fx_problem: fxProblem,
      } as unknown as Record<string, unknown>,
      created_by: userId,
    } as never)
    .select("id")
    .maybeSingle();
  if (runError || !runRow) throw new Error("The pricing audit run could not be started");
  const runId = (runRow as any).id as string;

  const { data: products } = await supabase
    .from("shopify_products")
    .select("id, shopify_product_id, handle, title, status, currency")
    .order("title", { ascending: true });

  const totals = Object.fromEntries(AUDIT_STATUSES.map((s) => [s, 0])) as AuditTotals;
  totals.variants = 0;
  totals.products = 0;
  totals.productsReprisable = 0;
  totals.productsHeld = 0;

  const fee = { variable: settings.payment_fee_variable, fixed: settings.payment_fee_fixed };
  const rows: Record<string, unknown>[] = [];

  for (const product of ((products ?? []) as any[])) {
    totals.products += 1;
    const productKey = String(product.shopify_product_id);
    const basis =
      shipping.get(productKey) ?? shipping.get(`uuid:${product.id}`) ?? UNLINKED;

    const evidence = assessShippingEvidence(
      {
        amount: basis.amount,
        currency: basis.currency,
        destination: basis.destination,
        service: basis.service,
        quotedAt: basis.quotedAt,
      },
      {
        market: settings.shipping_market,
        maxAgeDays: settings.shipping_quote_max_age_days,
      },
    );

    const { data: variants } = await supabase
      .from("shopify_product_variants")
      .select("shopify_variant_id, title, price, currency, unit_cost, unit_cost_currency, cost_source")
      .eq("product_id", product.id)
      .order("position", { ascending: true });

    const excluded =
      suppressed.has(String(product.id)) ||
      String(product.status ?? "").toUpperCase() === "ARCHIVED" ||
      String(product.status ?? "").toUpperCase() === "DRAFT";

    let productHasReady = false;

    for (const variant of ((variants ?? []) as any[])) {
      totals.variants += 1;
      const currentPrice = variant.price === null ? null : Number(variant.price);
      const unitCost = variant.unit_cost === null ? null : Number(variant.unit_cost);
      const costCurrency = variant.unit_cost_currency ?? null;

      let status: AuditStatus;
      let reason: string | null = null;
      let economics = computeEconomics({
        supplierItemCost: null,
        supplierShippingCost: null,
        referenceFxRate: fx?.rate ?? null,
        fxBufferPct: settings.fx_buffer_pct,
        targetMargin: settings.target_margin,
        fee,
        roundingMode: settings.rounding_mode,
        promoDiscount: settings.promo_discount,
        minPromoMargin: settings.min_promo_margin,
      });

      if (excluded) {
        status = "excluded_by_policy";
        reason = suppressed.has(String(product.id))
          ? "This listing is a suppressed duplicate, so its price is not customer facing"
          : "The listing is not active in the store";
      } else if (!basis.linked) {
        status = "held_unreliable_linkage";
        reason =
          "No supplier cost linkage record exists for this listing, so the landed cost basis cannot be confirmed. It predates the supplier integration.";
      } else if (unitCost === null) {
        status = "held_missing_cost";
        reason = "No cost of goods is recorded against this variant in the store";
      } else if (costCurrency && costCurrency !== settings.currency) {
        status = "held_unreliable_linkage";
        reason = `The recorded cost is in ${costCurrency} but pricing runs in ${settings.currency}, so the basis is not comparable`;
      } else if (!evidence.usable) {
        status = statusForEvidence(evidence.status);
        reason = evidence.reason;
      } else if (!fx) {
        status = "held_unreliable_linkage";
        reason = fxProblem ?? "No usable reference exchange rate is available for this run";
      } else {
        economics = computeEconomics({
          supplierItemCost: unitCost,
          itemCostIsSettlementCurrency: true,
          supplierShippingCost: evidence.amount,
          referenceFxRate: fx.rate,
          fxBufferPct: settings.fx_buffer_pct,
          targetMargin: settings.target_margin,
          fee,
          roundingMode: settings.rounding_mode,
          promoDiscount: settings.promo_discount,
          minPromoMargin: settings.min_promo_margin,
        });

        if (!economics.complete || economics.advertisedPrice === null) {
          status = "held_unreliable_linkage";
          reason = economics.reason;
        } else if (
          currentPrice !== null &&
          Math.abs(currentPrice - economics.advertisedPrice) < PENCE
        ) {
          status = "already_correct";
          reason = "The live price already matches the formula";
        } else {
          status = "ready_to_reprice";
          productHasReady = true;
        }
      }

      totals[status] += 1;
      rows.push({
        run_id: runId,
        product_id: product.id,
        shopify_product_id: productKey,
        handle: product.handle,
        product_title: product.title,
        shopify_variant_id: String(variant.shopify_variant_id),
        variant_title: variant.title,
        currency: settings.currency,
        current_price: currentPrice,
        unit_cost: unitCost,
        cost_source: variant.cost_source,
        shipping_cost: evidence.usable ? evidence.amount : basis.amount,
        shipping_source: basis.source,
        landed_cost: economics.protectedLandedCogs,
        calculated_price: economics.advertisedPrice,
        current_margin:
          currentPrice !== null && economics.protectedLandedCogs !== null && currentPrice > 0
            ? round2(
                ((currentPrice -
                  round2(currentPrice * fee.variable + fee.fixed) -
                  economics.protectedLandedCogs) /
                  currentPrice) *
                  10000,
              ) / 10000
            : null,
        proposed_margin: economics.expectedMargin,
        status,
        reason,
        supplier_currency: evidence.currency ?? basis.currency,
        supplier_item_cost_source: null,
        supplier_shipping_source_amount: evidence.usable ? evidence.amount : basis.amount,
        supplier_additional_cost: null,
        supplier_landed_total_source: economics.supplierLandedTotalSource,
        fx_reference_rate: fx?.rate ?? null,
        fx_source: fx?.source ?? settings.fx_source,
        fx_as_of: fx?.asOf ?? null,
        fx_buffer_pct: settings.fx_buffer_pct,
        fx_effective_rate: economics.effectiveFxRate,
        protected_landed_cogs: economics.protectedLandedCogs,
        fee_variable: fee.variable,
        fee_fixed: fee.fixed,
        required_price: economics.requiredPrice,
        expected_fee: economics.expectedFee,
        expected_payout: economics.expectedPayout,
        expected_profit: economics.expectedProfit,
        expected_margin: economics.expectedMargin,
        promo_price: economics.promoPrice,
        promo_profit: economics.promoProfit,
        promo_margin: economics.promoMargin,
        promo_within_floor: economics.promoWithinFloor,
        shipping_service: basis.service,
        shipping_destination: basis.destination,
        shipping_quoted_at: basis.quotedAt,
        evidence_status: evidence.status,
      });
    }

    if (productHasReady) totals.productsReprisable += 1;
    else if (!excluded) totals.productsHeld += 1;
  }

  for (let index = 0; index < rows.length; index += 400) {
    await supabase.from("pricing_audit_items").insert(rows.slice(index, index + 400) as never);
  }

  const held =
    totals.held_missing_cost +
    totals.held_missing_uk_shipping +
    totals.held_stale_shipping_quote +
    totals.held_unreliable_linkage;

  const message = `${totals.ready_to_reprice} variant(s) ready to reprice, ${totals.already_correct} already correct, ${held} held, ${totals.excluded_by_policy} excluded.${
    fxProblem ? ` Exchange rate problem: ${fxProblem}` : ""
  }`;

  await supabase
    .from("pricing_audit_runs")
    .update({
      status: "completed",
      totals: totals as unknown as Record<string, unknown>,
      message,
      completed_at: new Date().toISOString(),
    } as never)
    .eq("id", runId);

  return { runId, totals, message };
}
