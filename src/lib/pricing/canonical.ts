/**
 * The canonical NUR GOODS retail price calculation.
 *
 * This is the only place a customer facing price is allowed to come from.
 * Price authority, the publication lifecycle, the pricing audit, the supplier
 * refresh pass and the catalogue backfill all call this and nothing else, so
 * they can never disagree about what a product should cost.
 *
 * The commercial rule, stated once:
 *
 *   protected landed cost = item cost + supplier shipping, both in the selling
 *                           currency, supplier currency converted at a rate
 *                           deliberately worse than the reference rate
 *   price = ((protected landed cost * (1 + markup)) + fee_fixed)
 *           / (1 - fee_variable)
 *   advertised price = the smallest price ending .99 that is not below that
 *
 * The markup is a MARKUP ON COST, not a gross margin on the selling price.
 * A 60% markup means the intended profit is 60% of the landed cost. It is not
 * 60% of the price, and the two are not interchangeable: on a landed cost of
 * 10 a 60% markup targets 16 of revenue after fees, while a 60% gross margin
 * targets 25. Treating one as the other is exactly how a listing ends up
 * underpriced, so this module never accepts a "target margin" without being
 * told, by name, that it is a markup uplift.
 *
 * Shipping is a cost of goods here, never a revenue line: delivery is free to
 * the customer in every supported market. Because the store carries one base
 * price for every market, the calculation prices against the WORST verified
 * landed cost among the free shipping markets, so neither the UK nor the US
 * can sell at a loss.
 *
 * Everything fails closed. A missing cost, a missing quote for any one
 * required market, a stale quote, a quote for the wrong destination, a quote
 * with no currency or no service or no timestamp, or a missing exchange rate
 * all hold the product. Nothing is ever inferred, and a price that merely
 * happens to end in .99 is never treated as evidence of anything.
 *
 * Pure, no network, safe on the client.
 */
import { assessShippingEvidence, type ShippingEvidence } from "./shipping-evidence";

/** Identifies the calculation behind a stored price. */
export const CANONICAL_FORMULA_VERSION = "nur-landed-markup-v5";

/** Minimum markup on protected landed cost. 0.60 means +60% on cost. */
export const MINIMUM_MARKUP_UPLIFT = 0.6;

export type CanonicalStatus =
  | "priced"
  | "held_missing_cost"
  | "held_cost_currency"
  | "held_missing_shipping"
  | "held_stale_shipping"
  | "held_wrong_destination"
  | "held_ambiguous_shipping"
  | "held_no_fx"
  | "held_settings";

export const CANONICAL_STATUS_LABEL: Record<CanonicalStatus, string> = {
  priced: "Priced on verified landed cost",
  held_missing_cost: "Held: no cost of goods",
  held_cost_currency: "Held: cost recorded in another currency",
  held_missing_shipping: "Held: no shipping quote for a required market",
  held_stale_shipping: "Held: shipping quote too old",
  held_wrong_destination: "Held: shipping quote is for another destination",
  held_ambiguous_shipping: "Held: shipping quote basis is unclear",
  held_no_fx: "Held: no usable exchange rate",
  held_settings: "Held: pricing settings are not usable",
};

export interface CanonicalFee {
  /** Proportion of the selling price taken by the payment provider. */
  variable: number;
  /** Fixed amount taken per transaction, in the selling currency. */
  fixed: number;
}

/** A destination specific supplier shipping quote offered as evidence. */
export interface MarketShippingQuote extends ShippingEvidence {
  market: string;
}

export interface CanonicalPriceInput {
  /** Cost of goods for the variant, as recorded by the store. */
  itemCost: number | null | undefined;
  /** Currency the item cost is recorded in. Must equal the selling currency. */
  itemCostCurrency?: string | null | undefined;
  sellingCurrency: string;
  /** Every market the store promises free shipping into. All are required. */
  requiredMarkets: string[];
  quotes: MarketShippingQuote[];
  /**
   * Reference rates INTO the selling currency, keyed by source currency, for
   * example { USD: 0.78 }. The selling currency itself never needs one.
   */
  referenceFxRates: Record<string, number | null | undefined>;
  /** Protection applied on top of the reference rate, for example 0.04. */
  fxBufferPct: number;
  /** How old a shipping quote may be and still count as evidence. */
  quoteMaxAgeDays: number;
  fee: CanonicalFee;
  /** Markup ON COST. 0.6 means +60%. Never a gross margin. */
  markupUplift?: number;
  now?: Date;
}

export interface CanonicalMarketOutcome {
  market: string;
  usable: boolean;
  status: string;
  reason: string | null;
  sourceAmount: number | null;
  sourceCurrency: string | null;
  service: string | null;
  quotedAt: string | null;
  fxRate: number | null;
  shippingInSellingCurrency: number | null;
  landedCost: number | null;
}

export interface CanonicalPrice {
  status: CanonicalStatus;
  complete: boolean;
  reason: string | null;
  formulaVersion: string;
  sellingCurrency: string;
  itemCost: number | null;
  markupUplift: number;
  markupMultiplier: number;
  markets: CanonicalMarketOutcome[];
  /** The market whose landed cost the price had to cover. */
  worstMarket: string | null;
  protectedLandedCost: number | null;
  targetRevenue: number | null;
  rawPrice: number | null;
  price: number | null;
  expectedFee: number | null;
  expectedPayout: number | null;
  expectedProfit: number | null;
  /** Realised markup on landed cost at the advertised price. */
  realisedMarkup: number | null;
  /** Everything the price depends on, so a change forces a reprice. */
  fingerprint: string;
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function round6(value: number): number {
  return Math.round((value + Number.EPSILON) * 1e6) / 1e6;
}

/** Smallest price ending .99 that is not below the given price. */
export function charmUp(price: number): number {
  let charm = Math.floor(price) + 0.99;
  if (charm < price - 1e-9) charm += 1;
  return round2(charm);
}

/** The rate pricing may use: always worse than the reference rate. */
export function protectedFxRate(reference: number, bufferPct: number): number {
  return round6(reference * (1 + bufferPct));
}

/** Normalises a stored markup setting. Rejects anything that is not an uplift. */
export function markupUpliftFrom(value: unknown, fallback = MINIMUM_MARKUP_UPLIFT): number {
  const uplift = Number(value);
  if (!Number.isFinite(uplift) || uplift <= 0 || uplift >= 5) return fallback;
  return uplift;
}

/**
 * The single price equation. Exposed on its own so a test can assert the
 * markup semantics without assembling shipping evidence.
 */
export function priceFromProtectedLandedCost(
  protectedLandedCost: number,
  fee: CanonicalFee,
  markupUplift: number = MINIMUM_MARKUP_UPLIFT,
): { targetRevenue: number; rawPrice: number; price: number } | null {
  if (!Number.isFinite(protectedLandedCost) || protectedLandedCost <= 0) return null;
  if (!(fee.variable >= 0 && fee.variable < 1) || !(fee.fixed >= 0)) return null;
  if (!(markupUplift > 0)) return null;
  const targetRevenue = round2(protectedLandedCost * (1 + markupUplift));
  const rawPrice = (protectedLandedCost * (1 + markupUplift) + fee.fixed) / (1 - fee.variable);
  if (!Number.isFinite(rawPrice) || rawPrice <= 0) return null;
  return { targetRevenue, rawPrice: round6(rawPrice), price: charmUp(rawPrice) };
}

function statusForEvidence(status: string): CanonicalStatus {
  if (status === "missing") return "held_missing_shipping";
  if (status === "stale") return "held_stale_shipping";
  if (status === "wrong_destination") return "held_wrong_destination";
  return "held_ambiguous_shipping";
}

function normaliseMarket(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

/**
 * The pricing input fingerprint.
 *
 * It covers the cost of goods AND every piece of shipping evidence, including
 * each quote's amount, source currency, destination, service and timestamp,
 * plus the exchange rate, the protection buffer, the fees, the markup and the
 * formula version. Any movement in any of them changes the fingerprint, which
 * is what forces a reprice instead of letting an old price stand.
 */
export function canonicalFingerprint(input: {
  itemCost: number | null;
  itemCostCurrency: string | null;
  sellingCurrency: string;
  markets: CanonicalMarketOutcome[];
  fxBufferPct: number;
  fee: CanonicalFee;
  markupUplift: number;
  quoteMaxAgeDays: number;
}): string {
  const shipping = input.markets
    .slice()
    .sort((a, b) => a.market.localeCompare(b.market))
    .map((entry) =>
      [
        entry.market,
        entry.sourceAmount === null ? "none" : entry.sourceAmount.toFixed(4),
        entry.sourceCurrency ?? "none",
        entry.status,
        entry.service ?? "none",
        entry.quotedAt ?? "none",
        entry.fxRate === null ? "none" : entry.fxRate.toFixed(6),
      ].join("~"),
    )
    .join(",");

  return [
    CANONICAL_FORMULA_VERSION,
    input.sellingCurrency,
    input.itemCost === null ? "none" : input.itemCost.toFixed(4),
    input.itemCostCurrency ?? "none",
    `markup=${input.markupUplift}`,
    `feeVar=${input.fee.variable}`,
    `feeFixed=${input.fee.fixed}`,
    `fxBuffer=${input.fxBufferPct}`,
    `maxAge=${input.quoteMaxAgeDays}`,
    `ship=${shipping}`,
  ].join("|");
}

export function computeCanonicalPrice(input: CanonicalPriceInput): CanonicalPrice {
  const sellingCurrency = String(input.sellingCurrency ?? "").trim().toUpperCase();
  const markupUplift = markupUpliftFrom(input.markupUplift);
  const requiredMarkets = Array.from(
    new Set(input.requiredMarkets.map(normaliseMarket).filter(Boolean)),
  ).sort();
  const itemCost =
    typeof input.itemCost === "number" && Number.isFinite(input.itemCost) ? input.itemCost : null;
  const itemCostCurrency = input.itemCostCurrency
    ? String(input.itemCostCurrency).trim().toUpperCase()
    : null;
  const now = input.now ?? new Date();

  const markets: CanonicalMarketOutcome[] = requiredMarkets.map((market) => {
    const quote = input.quotes.find((entry) => normaliseMarket(entry.market) === market);
    const base: CanonicalMarketOutcome = {
      market,
      usable: false,
      status: "missing",
      reason: `No supplier shipping quote is recorded for ${market}`,
      sourceAmount: null,
      sourceCurrency: null,
      service: null,
      quotedAt: null,
      fxRate: null,
      shippingInSellingCurrency: null,
      landedCost: null,
    };
    if (!quote) return base;

    const quotedAt =
      quote.quotedAt instanceof Date
        ? quote.quotedAt.toISOString()
        : quote.quotedAt
          ? String(quote.quotedAt)
          : null;
    const assessment = assessShippingEvidence(
      {
        amount: quote.amount,
        currency: quote.currency,
        // The destination is taken from the evidence itself, never assumed
        // from the row it was filed under.
        destination: quote.destination ?? null,
        service: quote.service,
        quotedAt: quote.quotedAt,
      },
      { market, maxAgeDays: input.quoteMaxAgeDays, now },
    );

    const recorded: CanonicalMarketOutcome = {
      ...base,
      status: assessment.status,
      reason: assessment.reason,
      sourceAmount: typeof quote.amount === "number" ? quote.amount : null,
      sourceCurrency: quote.currency ? String(quote.currency).trim().toUpperCase() : null,
      service: quote.service ? String(quote.service) : null,
      quotedAt,
    };
    if (!assessment.usable) return recorded;

    const currency = assessment.currency ?? sellingCurrency;
    let rate: number;
    if (currency === sellingCurrency) {
      // Already settled in the selling currency. Never converted a second time.
      rate = 1;
    } else {
      const reference = Number(input.referenceFxRates[currency]);
      if (!Number.isFinite(reference) || reference <= 0) {
        return {
          ...recorded,
          usable: false,
          status: "no_fx",
          reason: `No usable ${currency} to ${sellingCurrency} exchange rate is available`,
        };
      }
      rate = protectedFxRate(reference, input.fxBufferPct);
    }

    const shipping = round2((assessment.amount ?? 0) * rate);
    return {
      ...recorded,
      usable: true,
      status: "verified",
      reason: null,
      fxRate: rate,
      shippingInSellingCurrency: shipping,
      landedCost: itemCost === null ? null : round2(itemCost + shipping),
    };
  });

  const fingerprint = canonicalFingerprint({
    itemCost,
    itemCostCurrency,
    sellingCurrency,
    markets,
    fxBufferPct: input.fxBufferPct,
    fee: input.fee,
    markupUplift,
    quoteMaxAgeDays: input.quoteMaxAgeDays,
  });

  const held = (status: CanonicalStatus, reason: string): CanonicalPrice => ({
    status,
    complete: false,
    reason,
    formulaVersion: CANONICAL_FORMULA_VERSION,
    sellingCurrency,
    itemCost,
    markupUplift,
    markupMultiplier: round6(1 + markupUplift),
    markets,
    worstMarket: null,
    protectedLandedCost: null,
    targetRevenue: null,
    rawPrice: null,
    price: null,
    expectedFee: null,
    expectedPayout: null,
    expectedProfit: null,
    realisedMarkup: null,
    fingerprint,
  });

  if (requiredMarkets.length === 0) {
    return held("held_settings", "No free shipping market is configured, so there is nothing to price against");
  }
  if (!(input.fxBufferPct >= 0 && input.fxBufferPct < 1)) {
    return held("held_settings", "The configured exchange rate protection is not a usable percentage");
  }
  if (!(input.fee.variable >= 0 && input.fee.variable < 1) || !(input.fee.fixed >= 0)) {
    return held("held_settings", "The payment fee settings are not usable");
  }
  if (itemCost === null) {
    return held("held_missing_cost", "No cost of goods is recorded against this variant in the store");
  }
  if (itemCost <= 0) {
    return held("held_missing_cost", "The store records a zero cost of goods, so no price can be derived");
  }
  if (itemCostCurrency && itemCostCurrency !== sellingCurrency) {
    return held(
      "held_cost_currency",
      `The recorded cost is in ${itemCostCurrency}, which is not comparable with ${sellingCurrency}`,
    );
  }

  // Every free shipping market must be evidenced. One missing market holds the
  // whole product, because the store carries a single base price.
  const unusable = markets.filter((entry) => !entry.usable);
  if (unusable.length > 0) {
    const first = unusable[0]!;
    const status: CanonicalStatus =
      first.status === "no_fx" ? "held_no_fx" : statusForEvidence(first.status);
    const detail = unusable
      .map((entry) => `${entry.market}: ${entry.reason ?? entry.status}`)
      .join("; ");
    return held(
      status,
      `Shipping evidence is not sufficient for every free shipping market (${detail})`,
    );
  }

  // The worst verified market sets the base price, so no supported market can
  // be sold at a loss while one catalogue price serves them all.
  let worst = markets[0]!;
  for (const entry of markets) {
    if ((entry.landedCost ?? 0) > (worst.landedCost ?? 0)) worst = entry;
  }
  const protectedLandedCost = worst.landedCost;
  if (protectedLandedCost === null) {
    return held("held_missing_cost", "The protected landed cost could not be established");
  }

  const solved = priceFromProtectedLandedCost(protectedLandedCost, input.fee, markupUplift);
  if (!solved) {
    return held("held_settings", "No selling price can satisfy the configured markup after fees");
  }

  const expectedFee = round2(solved.price * input.fee.variable + input.fee.fixed);
  const expectedPayout = round2(solved.price - expectedFee);
  const expectedProfit = round2(expectedPayout - protectedLandedCost);

  return {
    status: "priced",
    complete: true,
    reason: null,
    formulaVersion: CANONICAL_FORMULA_VERSION,
    sellingCurrency,
    itemCost,
    markupUplift,
    markupMultiplier: round6(1 + markupUplift),
    markets,
    worstMarket: worst.market,
    protectedLandedCost,
    targetRevenue: solved.targetRevenue,
    rawPrice: round2(solved.rawPrice),
    price: solved.price,
    expectedFee,
    expectedPayout,
    expectedProfit,
    realisedMarkup: round6(expectedProfit / protectedLandedCost),
    fingerprint,
  };
}
