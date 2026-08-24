/**
 * Server side inputs for the canonical NUR GOODS price.
 *
 * canonical.ts holds the calculation. This module gathers the facts it needs
 * and nothing else: the pricing settings in force, a fresh protected exchange
 * rate, and the destination specific supplier shipping evidence for every
 * market the store promises free delivery into.
 *
 * Nothing here writes to the store, and nothing here invents an input. When a
 * fact is missing the caller receives the absence and holds the product.
 */
import { zendropAdminClient } from "../zendrop/client.server";
import { loadPricingSettings } from "../zendrop/import.server";
import { getFxRate } from "../zendrop/fx.server";
import {
  computeCanonicalPrice,
  markupUpliftFrom,
  type CanonicalFee,
  type CanonicalPrice,
  type MarketShippingQuote,
} from "./canonical";
import { resolveFreeShippingMarkets, resolveSupportedMarkets, type MarketCode } from "./markets";

export interface CanonicalPricingContext {
  sellingCurrency: string;
  requiredMarkets: MarketCode[];
  fee: CanonicalFee;
  markupUplift: number;
  fxBufferPct: number;
  quoteMaxAgeDays: number;
  referenceFxRates: Record<string, number | null>;
  fxAsOf: string | null;
  fxSource: string | null;
  fxProblem: string | null;
}

/**
 * Loads everything that is the same for every product in a pricing pass.
 *
 * The supplier settles in dollars while the store sells in pounds, so a
 * reference rate is fetched once per pass and rejected outright when it is
 * older than the freshness policy. A stale rate is treated as no rate.
 */
export async function loadCanonicalPricingContext(): Promise<CanonicalPricingContext> {
  const settings = await loadPricingSettings();
  const supported = resolveSupportedMarkets(settings.supported_markets);
  const requiredMarkets = resolveFreeShippingMarkets(settings.free_shipping_markets, supported);
  const sellingCurrency = String(settings.currency ?? "GBP").toUpperCase();

  const referenceFxRates: Record<string, number | null> = { [sellingCurrency]: 1 };
  let fxAsOf: string | null = null;
  let fxSource: string | null = null;
  let fxProblem: string | null = null;

  if (sellingCurrency !== "USD") {
    try {
      const fx = await getFxRate("USD", sellingCurrency);
      const ageHours = (Date.now() - new Date(`${fx.asOf}T00:00:00Z`).getTime()) / 3_600_000;
      if (Number.isFinite(ageHours) && ageHours > settings.fx_quote_max_age_hours) {
        fxProblem = `The reference exchange rate is dated ${fx.asOf}, older than the ${settings.fx_quote_max_age_hours} hour freshness policy`;
        referenceFxRates["USD"] = null;
      } else {
        referenceFxRates["USD"] = fx.rate;
        fxAsOf = fx.asOf;
        fxSource = fx.source;
      }
    } catch (cause) {
      fxProblem = cause instanceof Error ? cause.message : "No reference exchange rate is available";
      referenceFxRates["USD"] = null;
    }
  }

  return {
    sellingCurrency,
    requiredMarkets,
    fee: {
      variable: Number(settings.payment_fee_variable),
      fixed: Number(settings.payment_fee_fixed),
    },
    // The stored setting is an uplift on cost. It is never read as a gross
    // margin here, whatever the column happens to be called.
    markupUplift: markupUpliftFrom(settings.target_margin),
    fxBufferPct: Number(settings.fx_buffer_pct),
    quoteMaxAgeDays: Number(settings.shipping_quote_max_age_days),
    referenceFxRates,
    fxAsOf,
    fxSource,
    fxProblem,
  };
}

/**
 * Reads the recorded destination quotes for a set of store products.
 *
 * Evidence is keyed on the store product where the row carries one, and
 * recovered through the supplier link where it does not, so a product whose
 * eligibility was captured before the link existed is still priced correctly.
 */
export async function loadShippingEvidenceForProducts(
  shopifyProductIds: string[],
): Promise<Map<string, MarketShippingQuote[]>> {
  const ids = Array.from(new Set(shopifyProductIds.filter(Boolean)));
  const byProduct = new Map<string, MarketShippingQuote[]>();
  if (ids.length === 0) return byProduct;

  const supabase = await zendropAdminClient();

  const { data: links } = await supabase
    .from("product_supplier_links")
    .select("shopify_product_id, supplier_product_id")
    .in("shopify_product_id", ids);
  const supplierByProduct = new Map<string, string>();
  const productBySupplier = new Map<string, string>();
  for (const row of (links ?? []) as any[]) {
    const shopifyId = String(row.shopify_product_id ?? "");
    const supplierId = row.supplier_product_id ? String(row.supplier_product_id) : "";
    if (!shopifyId || !supplierId) continue;
    supplierByProduct.set(shopifyId, supplierId);
    productBySupplier.set(supplierId, shopifyId);
  }

  const push = (shopifyId: string, quote: MarketShippingQuote) => {
    const existing = byProduct.get(shopifyId);
    if (existing) existing.push(quote);
    else byProduct.set(shopifyId, [quote]);
  };

  const toQuote = (row: any): MarketShippingQuote => ({
    market: String(row.market ?? "").toUpperCase(),
    amount:
      row.shipping_amount === null || row.shipping_amount === undefined
        ? null
        : Number(row.shipping_amount),
    currency: row.shipping_currency ?? null,
    // The destination is the market the quote was taken for, recorded on the
    // row itself rather than assumed from the product.
    destination: String(row.market ?? "").toUpperCase(),
    service: row.shipping_service ?? null,
    quotedAt: row.quoted_at ?? null,
  });

  const { data: direct } = await supabase
    .from("product_market_eligibility")
    .select("shopify_product_id, market, shipping_amount, shipping_currency, shipping_service, quoted_at")
    .in("shopify_product_id", ids);
  for (const row of (direct ?? []) as any[]) {
    push(String(row.shopify_product_id), toQuote(row));
  }

  const missing = ids.filter((id) => !byProduct.has(id) && supplierByProduct.has(id));
  const supplierIds = missing
    .map((id) => supplierByProduct.get(id))
    .filter((value): value is string => Boolean(value));
  if (supplierIds.length > 0) {
    const { data: viaSupplier } = await supabase
      .from("product_market_eligibility")
      .select("supplier_product_id, market, shipping_amount, shipping_currency, shipping_service, quoted_at")
      .in("supplier_product_id", supplierIds);
    for (const row of (viaSupplier ?? []) as any[]) {
      const shopifyId = productBySupplier.get(String(row.supplier_product_id));
      if (shopifyId) push(shopifyId, toQuote(row));
    }
  }

  return byProduct;
}

/** Applies the canonical calculation to one variant using a loaded context. */
export function priceVariant(input: {
  context: CanonicalPricingContext;
  itemCost: number | null;
  itemCostCurrency: string | null;
  quotes: MarketShippingQuote[];
  now?: Date;
}): CanonicalPrice {
  return computeCanonicalPrice({
    itemCost: input.itemCost,
    itemCostCurrency: input.itemCostCurrency,
    sellingCurrency: input.context.sellingCurrency,
    requiredMarkets: input.context.requiredMarkets,
    quotes: input.quotes,
    referenceFxRates: input.context.referenceFxRates,
    fxBufferPct: input.context.fxBufferPct,
    quoteMaxAgeDays: input.context.quoteMaxAgeDays,
    fee: input.context.fee,
    markupUplift: input.context.markupUplift,
    ...(input.now ? { now: input.now } : {}),
  });
}
