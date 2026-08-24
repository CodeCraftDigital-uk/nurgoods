/**
 * Regression cover for the marinade injector incident.
 *
 * The listing had verified supplier shipping quotes for both free shipping
 * markets, GB USD 4.24 and US USD 6.08, and was still priced from the cost of
 * goods alone. That put it on sale below the commercial floor. These tests
 * pin the behaviour that prevents it happening again:
 *
 *   - shipping is part of the cost the price has to cover
 *   - the worst supported market sets the floor, not the cheapest one
 *   - the target is a markup ON cost, never a gross margin
 *   - missing evidence for any required market holds the variant
 */
import { describe, expect, it } from "vitest";
import {
  MINIMUM_MARKUP_UPLIFT,
  charmUp,
  computeCanonicalPrice,
  priceFromProtectedLandedCost,
  type CanonicalPriceInput,
} from "./canonical";

const NOW = new Date("2026-03-01T00:00:00.000Z");
const QUOTED_AT = "2026-02-20T00:00:00.000Z";
const FEE = { variable: 0.02, fixed: 0.25 };
/** Reference rate into the selling currency, before protection. */
const USD_TO_GBP = 0.78;

function marinadeInput(overrides: Partial<CanonicalPriceInput> = {}): CanonicalPriceInput {
  return {
    itemCost: 12.5,
    itemCostCurrency: "GBP",
    sellingCurrency: "GBP",
    requiredMarkets: ["GB", "US"],
    quotes: [
      {
        market: "GB",
        amount: 4.24,
        currency: "USD",
        destination: "GB",
        service: "Standard",
        quotedAt: QUOTED_AT,
      },
      {
        market: "US",
        amount: 6.08,
        currency: "USD",
        destination: "US",
        service: "Standard",
        quotedAt: QUOTED_AT,
      },
    ],
    referenceFxRates: { USD: USD_TO_GBP },
    fxBufferPct: 0.04,
    quoteMaxAgeDays: 30,
    fee: FEE,
    markupUplift: MINIMUM_MARKUP_UPLIFT,
    now: NOW,
    ...overrides,
  };
}

describe("markup semantics", () => {
  it("treats the target as an uplift on cost, not a gross margin", () => {
    const priced = priceFromProtectedLandedCost(10, FEE, 0.6);
    expect(priced).not.toBeNull();
    // Markup: revenue target is 16.00, so the raw price is (16 + 0.25) / 0.98.
    expect(priced!.targetRevenue).toBeCloseTo(16, 2);
    expect(priced!.rawPrice).toBeCloseTo(16.5816, 3);
    expect(priced!.price).toBe(16.99);
    // A gross margin reading of the same figure would have produced 25.00+,
    // so the two can never be confused silently again.
    expect(priced!.price).toBeLessThan(25);
  });

  it("only ever rounds upward, to a charm price", () => {
    for (const cost of [1, 3.33, 12.5, 21.79, 44.45, 180.4]) {
      const priced = priceFromProtectedLandedCost(cost, FEE, 0.6)!;
      expect(charmUp(priced.rawPrice)).toBe(priced.price);
      expect(priced.price).toBeGreaterThanOrEqual(priced.rawPrice);
      expect(Math.round(priced.price * 100) % 100).toBe(99);
    }
  });
});

describe("marinade injector incident", () => {
  it("covers supplier shipping instead of pricing from cost of goods alone", () => {
    const withShipping = computeCanonicalPrice(marinadeInput());
    const itemCostOnly = priceFromProtectedLandedCost(12.5, FEE, MINIMUM_MARKUP_UPLIFT)!;

    expect(withShipping.status).toBe("priced");
    expect(withShipping.complete).toBe(true);
    expect(withShipping.price).toBeGreaterThan(itemCostOnly.price);
  });

  it("prices against the most expensive required market", () => {
    const result = computeCanonicalPrice(marinadeInput());
    const protectedRate = USD_TO_GBP * 1.04;
    const worstShipping = 6.08 * protectedRate;

    expect(result.worstMarket).toBe("US");
    expect(result.protectedLandedCost).toBeCloseTo(12.5 + worstShipping, 2);
    expect(result.markets.every((market) => market.usable)).toBe(true);
  });

  it("still clears the minimum markup on the worst market's landed cost", () => {
    const result = computeCanonicalPrice(marinadeInput());
    const landed = result.protectedLandedCost!;
    expect((result.price! - landed - result.expectedFee!) / landed).toBeGreaterThanOrEqual(
      MINIMUM_MARKUP_UPLIFT,
    );
    expect(result.realisedMarkup).toBeGreaterThanOrEqual(MINIMUM_MARKUP_UPLIFT);
  });

  it("holds when a required market has no shipping evidence", () => {
    const result = computeCanonicalPrice(
      marinadeInput({
        quotes: [
          {
            market: "GB",
            amount: 4.24,
            currency: "USD",
            destination: "GB",
            service: "Standard",
            quotedAt: QUOTED_AT,
          },
        ],
      }),
    );
    expect(result.complete).toBe(false);
    expect(result.status).toBe("held_missing_shipping");
    expect(result.price).toBeNull();
  });

  it("holds when the shipping evidence is too old to trust", () => {
    const result = computeCanonicalPrice(
      marinadeInput({ quoteMaxAgeDays: 3 }),
    );
    expect(result.complete).toBe(false);
    expect(result.status).toBe("held_stale_shipping");
  });

  it("changes the pricing fingerprint when a shipping quote moves", () => {
    const before = computeCanonicalPrice(marinadeInput());
    const after = computeCanonicalPrice(
      marinadeInput({
        quotes: [
          {
            market: "GB",
            amount: 4.24,
            currency: "USD",
            destination: "GB",
            service: "Standard",
            quotedAt: QUOTED_AT,
          },
          {
            market: "US",
            amount: 9.4,
            currency: "USD",
            destination: "US",
            service: "Standard",
            quotedAt: QUOTED_AT,
          },
        ],
      }),
    );
    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(after.price).toBeGreaterThan(before.price!);
  });
});
