/**
 * Supported sales and fulfilment markets.
 *
 * NUR GOODS sells into the United Kingdom and the United States. Both are
 * first class markets: a product may be sourced, priced and published for one
 * of them, for both, or for neither, and the answer has to come from real
 * supplier shipping evidence for that specific destination rather than from a
 * single global assumption.
 *
 * Everything here is pure so the admin preview, the import pipeline and the
 * storefront copy all agree without a round trip.
 */
import { assessShippingEvidence, type ShippingEvidence } from "./shipping-evidence";

export const MARKETS = {
  GB: {
    code: "GB",
    country: "United Kingdom",
    short: "UK",
    currency: "GBP",
    locale: "en-GB",
  },
  US: {
    code: "US",
    country: "United States",
    short: "USA",
    currency: "USD",
    locale: "en-US",
  },
} as const;

export type MarketCode = keyof typeof MARKETS;

export const MARKET_CODES = Object.keys(MARKETS) as MarketCode[];

export function isMarketCode(value: unknown): value is MarketCode {
  return typeof value === "string" && Object.hasOwn(MARKETS, value.trim().toUpperCase());
}

/**
 * Cleans a stored or submitted market list. Unknown codes are dropped rather
 * than trusted, duplicates collapse, and order follows MARKET_CODES so two
 * equivalent lists always render identically.
 */
export function normaliseMarkets(input: unknown): MarketCode[] {
  const raw = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(",")
      : [];
  const seen = new Set<MarketCode>();
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const code = entry.trim().toUpperCase();
    if (isMarketCode(code)) seen.add(code as MarketCode);
  }
  return MARKET_CODES.filter((code) => seen.has(code));
}

/** Never returns an empty list: an empty configuration falls back to the UK. */
export function resolveSupportedMarkets(input: unknown): MarketCode[] {
  const markets = normaliseMarkets(input);
  return markets.length > 0 ? markets : ["GB"];
}

/**
 * Free shipping may only be promised for a market the store actually supports,
 * so the public claim can never drift wider than the operating footprint.
 */
export function resolveFreeShippingMarkets(input: unknown, supported: MarketCode[]): MarketCode[] {
  const requested = normaliseMarkets(input).filter((code) => supported.includes(code));
  return requested.length > 0 ? requested : supported;
}

function joinShort(markets: MarketCode[]): string {
  const names = markets.map((code) => MARKETS[code].short);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")} & ${names.at(-1)}`;
}

/** Short badge wording, for example "Free UK & USA shipping". */
export function freeShippingBadgeLabel(markets: MarketCode[]): string {
  if (markets.length === 0) return "Shipping calculated at checkout";
  return `Free ${joinShort(markets)} shipping`;
}

/** Sentence wording, for example "Free shipping in the UK & USA." */
export function freeShippingHeadline(markets: MarketCode[]): string {
  if (markets.length === 0) return "Shipping is calculated at checkout.";
  return `Free shipping in the ${joinShort(markets)}.`;
}

/**
 * Full claim. It always names the delivery footprint explicitly so nothing
 * implies worldwide free delivery.
 */
export function freeShippingStatement(markets: MarketCode[]): string {
  if (markets.length === 0) {
    return "Shipping is calculated at checkout.";
  }
  const countries = markets.map((code) => MARKETS[code].country);
  const footprint =
    countries.length === 1
      ? `the ${countries[0]}`
      : `${countries.slice(0, -1).map((c) => `the ${c}`).join(", ")} and the ${countries.at(-1)}`;
  return `Free shipping in the ${joinShort(markets)}, included in the price shown. We deliver to ${footprint} only.`;
}

/* --------------------------- market eligibility --------------------------- */

export interface MarketEvidence extends ShippingEvidence {
  market: string;
}

export interface MarketEligibility {
  market: MarketCode;
  eligible: boolean;
  status: string;
  amount: number | null;
  currency: string | null;
  reason: string | null;
}

export interface MarketEligibilityResult {
  markets: MarketEligibility[];
  eligibleMarkets: MarketCode[];
  /** A product may only be imported or published when at least one market qualifies. */
  qualifies: boolean;
  reason: string | null;
}

/**
 * Decides, market by market, whether the supplier shipping evidence is good
 * enough to carry that destination. Missing evidence fails closed: a market
 * with no quote is simply not offered.
 */
export function evaluateMarketEligibility(input: {
  supported: MarketCode[];
  evidence: MarketEvidence[];
  maxAgeDays: number;
  now?: Date;
}): MarketEligibilityResult {
  const markets: MarketEligibility[] = input.supported.map((code) => {
    const found = input.evidence.find(
      (entry) => (entry.market ?? "").trim().toUpperCase() === code,
    );
    if (!found) {
      return {
        market: code,
        eligible: false,
        status: "missing",
        amount: null,
        currency: null,
        reason: `No supplier shipping quote is recorded for ${MARKETS[code].country}`,
      };
    }
    const assessment = assessShippingEvidence(found, {
      market: code,
      maxAgeDays: input.maxAgeDays,
      ...(input.now ? { now: input.now } : {}),
    });
    return {
      market: code,
      eligible: assessment.usable,
      status: assessment.status,
      amount: assessment.amount,
      currency: assessment.currency,
      reason: assessment.reason,
    };
  });

  const eligibleMarkets = markets.filter((m) => m.eligible).map((m) => m.market);
  return {
    markets,
    eligibleMarkets,
    qualifies: eligibleMarkets.length > 0,
    reason:
      eligibleMarkets.length > 0
        ? null
        : "No supported market has usable supplier shipping evidence",
  };
}

/* ------------------------------ currency guard ---------------------------- */

export interface MarketCurrencyCheck {
  ok: boolean;
  reason: string | null;
}

/**
 * The store prices and settles in a single selling currency today. Pricing a
 * market whose currency differs from the configured selling currency would
 * mean inventing a conversion nobody has verified, so it fails closed with an
 * explicit reason instead.
 */
export function checkPricingCurrency(market: MarketCode, sellingCurrency: string): MarketCurrencyCheck {
  const expected = MARKETS[market].currency;
  const actual = (sellingCurrency ?? "").trim().toUpperCase();
  if (!actual) {
    return { ok: false, reason: "No selling currency is configured" };
  }
  if (actual !== expected) {
    return {
      ok: false,
      reason: `Prices are held in ${actual} while ${MARKETS[market].country} settles in ${expected}. A verified ${actual} to ${expected} presentment policy is required before ${MARKETS[market].short} prices can be published.`,
    };
  }
  return { ok: true, reason: null };
}

/**
 * The market whose currency matches the configured selling currency. Pricing
 * maths runs against this one; other supported markets are fulfilment and
 * shipping footprint until a presentment policy exists for them.
 */
export function resolvePricingMarket(
  supported: MarketCode[],
  sellingCurrency: string,
  configured: string,
): MarketCode {
  const preferred = normaliseMarkets([configured])[0];
  if (preferred && supported.includes(preferred)) return preferred;
  const byCurrency = supported.find(
    (code) => MARKETS[code].currency === (sellingCurrency ?? "").trim().toUpperCase(),
  );
  return byCurrency ?? supported[0] ?? "GB";
}
