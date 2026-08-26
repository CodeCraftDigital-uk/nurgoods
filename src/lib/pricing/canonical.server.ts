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

type ShippingEvidenceRow = {
  shopify_product_id?: string | null;
  supplier_product_id?: string | null;
  market?: string | null;
  shipping_amount?: number | null;
  shipping_currency?: string | null;
  shipping_service?: string | null;
  quoted_at?: string | null;
};

type SupplierLinkRow = {
  shopify_product_id?: string | null;
  supplier_product_id?: string | null;
};

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
 * Evidence arrives in two shapes: rows keyed on the store product, and rows
 * keyed only on the supplier product. Both are considered for every requested
 * product, market by market, so an incomplete or stale direct row can never
 * hide fresher supplier evidence, and a direct row for one market can never
 * suppress supplier evidence for another. For each market the newest complete
 * quote wins, and direct evidence only breaks a tie.
 */
export function indexShippingEvidence(
  shopifyProductIds: string[],
  directRows: ShippingEvidenceRow[],
  supplierRows: ShippingEvidenceRow[],
  links: SupplierLinkRow[],
): Map<string, MarketShippingQuote[]> {
  const wanted = new Set(shopifyProductIds.map(String));
  const productBySupplier = new Map<string, string>();
  for (const link of links) {
    const productId = String(link.shopify_product_id ?? "");
    const supplierId = String(link.supplier_product_id ?? "");
    if (wanted.has(productId) && supplierId) productBySupplier.set(supplierId, productId);
  }

  type Candidate = { quote: MarketShippingQuote; complete: boolean; at: number; direct: boolean };
  const indexed = new Map<string, Map<string, Candidate>>();

  const consider = (productId: string, row: ShippingEvidenceRow, direct: boolean) => {
    if (!wanted.has(productId)) return;
    const market = String(row.market ?? "").trim().toUpperCase();
    if (!market) return;

    const amount =
      row.shipping_amount === null || row.shipping_amount === undefined
        ? null
        : Number(row.shipping_amount);
    const complete = amount !== null && Number.isFinite(amount);
    const parsed = row.quoted_at ? Date.parse(row.quoted_at) : Number.NaN;
    const at = Number.isFinite(parsed) ? parsed : 0;

    const candidate: Candidate = {
      quote: {
        market,
        amount: complete ? amount : null,
        currency: row.shipping_currency ?? null,
        destination: market,
        service: row.shipping_service ?? null,
        quotedAt: row.quoted_at ?? null,
      },
      complete,
      at,
      direct,
    };

    const byMarket = indexed.get(productId) ?? new Map<string, Candidate>();
    const existing = byMarket.get(market);
    if (!existing || beats(candidate, existing)) byMarket.set(market, candidate);
    indexed.set(productId, byMarket);
  };

  // Deterministic: usable quote first, then freshest, then direct product
  // evidence as the tie break.
  const beats = (a: Candidate, b: Candidate): boolean => {
    if (a.complete !== b.complete) return a.complete;
    if (a.at !== b.at) return a.at > b.at;
    if (a.direct !== b.direct) return a.direct;
    return false;
  };

  for (const row of supplierRows) {
    const productId = productBySupplier.get(String(row.supplier_product_id ?? ""));
    if (productId) consider(productId, row, false);
    const directId = String(row.shopify_product_id ?? "");
    if (directId && wanted.has(directId)) consider(directId, row, true);
  }
  for (const row of directRows) consider(String(row.shopify_product_id ?? ""), row, true);

  return new Map(
    shopifyProductIds.map((productId) => [
      productId,
      [...(indexed.get(productId)?.values() ?? [])]
        .map((candidate) => candidate.quote)
        .sort((a, b) => a.market.localeCompare(b.market)),
    ]),
  );
}


export async function loadShippingEvidenceForProducts(
  shopifyProductIds: string[],
): Promise<Map<string, MarketShippingQuote[]>> {
  const ids = Array.from(new Set(shopifyProductIds.filter(Boolean)));
  if (ids.length === 0) return new Map();

  const supabase = await zendropAdminClient();
  const { data: links } = await supabase
    .from("product_supplier_links")
    .select("shopify_product_id, supplier_product_id")
    .in("shopify_product_id", ids);
  const linkRows = (links ?? []) as SupplierLinkRow[];
  const supplierIds = Array.from(
    new Set(linkRows.map((row) => row.supplier_product_id).filter(Boolean).map(String)),
  );

  const { data: direct } = await supabase
    .from("product_market_eligibility")
    .select("shopify_product_id, supplier_product_id, market, shipping_amount, shipping_currency, shipping_service, quoted_at")
    .in("shopify_product_id", ids);
  const { data: viaSupplier } = supplierIds.length
    ? await supabase
        .from("product_market_eligibility")
        .select("shopify_product_id, supplier_product_id, market, shipping_amount, shipping_currency, shipping_service, quoted_at")
        .in("supplier_product_id", supplierIds)
    : { data: [] as ShippingEvidenceRow[] };

  return indexShippingEvidence(
    ids,
    (direct ?? []) as ShippingEvidenceRow[],
    (viaSupplier ?? []) as ShippingEvidenceRow[],
    linkRows,
  );
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
