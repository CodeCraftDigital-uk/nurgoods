import { describe, expect, it } from "vitest";
import {
  checkPricingCurrency,
  evaluateMarketEligibility,
  freeShippingBadgeLabel,
  freeShippingHeadline,
  freeShippingStatement,
  normaliseMarkets,
  resolveFreeShippingMarkets,
  resolvePricingMarket,
  resolveSupportedMarkets,
} from "./markets";

describe("market normalisation", () => {
  it("accepts arrays, strings and mixed case while dropping unknown codes", () => {
    expect(normaliseMarkets(["us", "GB", "gb", "FR"])).toEqual(["GB", "US"]);
    expect(normaliseMarkets("GB, US")).toEqual(["GB", "US"]);
    expect(normaliseMarkets(null)).toEqual([]);
  });

  it("falls back to the United Kingdom rather than supporting nothing", () => {
    expect(resolveSupportedMarkets([])).toEqual(["GB"]);
    expect(resolveSupportedMarkets(["ZZ"])).toEqual(["GB"]);
  });

  it("never promises free shipping outside the supported footprint", () => {
    expect(resolveFreeShippingMarkets(["GB", "US"], ["GB"])).toEqual(["GB"]);
    expect(resolveFreeShippingMarkets([], ["GB", "US"])).toEqual(["GB", "US"]);
  });
});

describe("customer facing wording", () => {
  it("covers both markets without implying worldwide delivery", () => {
    expect(freeShippingBadgeLabel(["GB", "US"])).toBe("Free UK & USA shipping");
    expect(freeShippingHeadline(["GB", "US"])).toBe("Free shipping in the UK & USA.");
    const statement = freeShippingStatement(["GB", "US"]);
    expect(statement).toContain("United Kingdom");
    expect(statement).toContain("United States");
    expect(statement).toContain("only");
    expect(statement.toLowerCase()).not.toContain("worldwide");
  });

  it("stays accurate for a single market", () => {
    expect(freeShippingBadgeLabel(["GB"])).toBe("Free UK shipping");
    expect(freeShippingHeadline(["US"])).toBe("Free shipping in the USA.");
  });
});

describe("market eligibility", () => {
  const fresh = new Date("2026-01-10T00:00:00.000Z");
  const quotedAt = "2026-01-09T00:00:00.000Z";

  it("qualifies a market with a fresh destination specific quote", () => {
    const result = evaluateMarketEligibility({
      supported: ["GB", "US"],
      maxAgeDays: 30,
      now: fresh,
      evidence: [
        {
          market: "GB",
          amount: 3.2,
          currency: "USD",
          destination: "GB",
          service: "standard",
          quotedAt,
        },
      ],
    });
    expect(result.eligibleMarkets).toEqual(["GB"]);
    expect(result.qualifies).toBe(true);
    expect(result.markets.find((m) => m.market === "US")?.status).toBe("missing");
  });

  it("fails closed when no market has usable evidence", () => {
    const result = evaluateMarketEligibility({
      supported: ["GB", "US"],
      maxAgeDays: 30,
      now: fresh,
      evidence: [
        {
          market: "US",
          amount: 4.1,
          currency: "USD",
          destination: "US",
          service: "standard",
          quotedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
    });
    expect(result.qualifies).toBe(false);
    expect(result.markets.find((m) => m.market === "US")?.status).toBe("stale");
    expect(result.reason).toContain("No supported market");
  });

  it("refuses a quote taken for the wrong destination", () => {
    const result = evaluateMarketEligibility({
      supported: ["US"],
      maxAgeDays: 30,
      now: fresh,
      evidence: [
        { market: "US", amount: 2, currency: "USD", destination: "GB", service: "std", quotedAt },
      ],
    });
    expect(result.qualifies).toBe(false);
    expect(result.markets[0]?.status).toBe("wrong_destination");
  });
});

describe("currency guard", () => {
  it("allows the market whose currency matches the selling currency", () => {
    expect(checkPricingCurrency("GB", "GBP").ok).toBe(true);
  });

  it("refuses to invent a price for a market in another currency", () => {
    const check = checkPricingCurrency("US", "GBP");
    expect(check.ok).toBe(false);
    expect(check.reason).toContain("USD");
  });

  it("picks the configured pricing market when it is supported", () => {
    expect(resolvePricingMarket(["GB", "US"], "GBP", "GB")).toBe("GB");
    expect(resolvePricingMarket(["GB", "US"], "GBP", "ZZ")).toBe("GB");
    expect(resolvePricingMarket(["US"], "USD", "GB")).toBe("US");
  });
});
