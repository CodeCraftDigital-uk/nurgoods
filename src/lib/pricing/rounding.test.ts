import { describe, expect, it } from "vitest";
import { applyRounding, computePricing, DEFAULT_PRICING } from "@/lib/zendrop/pricing";
import { retailRoundingOutcome } from "@/lib/intake/validate";
import type { ProductBundle } from "@/lib/intelligence/core.server";

/**
 * Guards the approved NUR GOODS retail pricing rule. A variant may never reach
 * a customer with an arbitrary pence ending, and the formula must always price
 * at or above the configured true gross margin after rounding.
 */

function endsIn99(value: number): boolean {
  return Math.round(value * 100) % 100 === 99;
}

function bundle(prices: Array<number | null>, availability: boolean[] = []): ProductBundle {
  return {
    product: {},
    media: [],
    variants: prices.map((price, index) => ({
      price,
      available_for_sale: availability[index] ?? true,
    })),
  } as unknown as ProductBundle;
}

describe("charm_99 rounding", () => {
  it("always rounds up to a .99 ending", () => {
    for (const raw of [0.01, 1, 1.5, 9.99, 10.0, 10.01, 23.37, 48.5, 119.44, 259.0]) {
      const rounded = applyRounding(raw, "charm_99");
      expect(endsIn99(rounded)).toBe(true);
      expect(rounded).toBeGreaterThanOrEqual(raw);
    }
  });

  it("never rounds a price down below the target margin", () => {
    for (const cost of [0.59, 1.46, 3.23, 7.47, 19.47, 44.21, 119.44]) {
      for (const shipping of [2.49, 4.25, 6.13]) {
        const result = computePricing({
          supplierCost: cost,
          shippingCost: shipping,
          settings: DEFAULT_PRICING,
        });
        expect(result.complete).toBe(true);
        expect(endsIn99(result.price as number)).toBe(true);
        expect(result.grossMargin as number).toBeGreaterThanOrEqual(DEFAULT_PRICING.target_margin);
      }
    }
  });

  it("holds pricing when a cost input is missing rather than inventing one", () => {
    expect(computePricing({ supplierCost: 5, shippingCost: null, settings: DEFAULT_PRICING }).price).toBeNull();
    expect(computePricing({ supplierCost: null, shippingCost: 3, settings: DEFAULT_PRICING }).price).toBeNull();
  });
});

describe("intake retail rounding gate", () => {
  it("passes when every purchasable variant ends in .99", () => {
    expect(retailRoundingOutcome(bundle([12.99, 14.99, 19.99])).passed).toBe(true);
  });

  it("blocks a multi variant product when a single option is unrounded", () => {
    const outcome = retailRoundingOutcome(bundle([12.99, 14.55, 19.99]));
    expect(outcome.passed).toBe(false);
    expect(outcome.detail).toContain("14.55");
  });

  it("blocks the arbitrary pence endings the owner reported", () => {
    for (const price of [23.37, 48.5, 47.75, 111.0, 259.0, 74.96]) {
      expect(retailRoundingOutcome(bundle([price])).passed).toBe(false);
    }
  });

  it("ignores variants that are not purchasable", () => {
    expect(retailRoundingOutcome(bundle([12.99, 14.55], [true, false])).passed).toBe(true);
  });

  it("does not fail a product that has no priced variant yet", () => {
    expect(retailRoundingOutcome(bundle([null])).passed).toBe(true);
  });
});
