import { describe, expect, it } from "vitest";
import { endsInCharm99, expectedRetailPrice, APPROVED_PRICING_EXEMPTIONS } from "./integrity.server";

/**
 * The stored target figure is a markup uplift ON landed cost, never a gross
 * margin, and payment fees sit on top of it.
 */
const settings = {
  target_margin: 0.6,
  rounding_mode: "charm_99" as const,
  payment_fee_variable: 0.02,
  payment_fee_fixed: 0.25,
};

describe("charm price detection", () => {
  it("accepts only prices ending in .99", () => {
    for (const price of [0.99, 9.99, 97.99, 1299.99]) {
      expect(endsInCharm99(price)).toBe(true);
    }
    for (const price of [97.29, 12.5, 20, 8.9, 45.98, 100.0]) {
      expect(endsInCharm99(price)).toBe(false);
    }
  });

  it("treats a missing price as non compliant", () => {
    expect(endsInCharm99(null)).toBe(false);
    expect(endsInCharm99(undefined)).toBe(false);
    expect(endsInCharm99(Number.NaN)).toBe(false);
  });
});

describe("retail price derivation", () => {
  it("applies a markup on landed cost, then payment fees", () => {
    const result = expectedRetailPrice(21.79, 4.5, settings);
    expect(result.landedCost).toBe(26.29);
    // 26.29 * 1.6 = 42.064, plus 0.25 fixed, divided by 0.98 = 43.18
    expect(result.rawPrice).toBeCloseTo(43.18, 2);
    expect(result.price).toBe(43.99);
    expect(endsInCharm99(result.price)).toBe(true);
  });

  it("always produces a charm price at or above the raw formula price", () => {
    for (let cost = 1; cost <= 300; cost += 1) {
      for (const shipping of [0, 1.25, 3.99, 12.4]) {
        const { rawPrice, price } = expectedRetailPrice(cost, shipping, settings);
        expect(price).not.toBeNull();
        expect(endsInCharm99(price)).toBe(true);
        expect(price as number).toBeGreaterThanOrEqual(rawPrice as number);
        // Rounding up never adds a whole pound of margin.
        expect((price as number) - (rawPrice as number)).toBeLessThan(1);
      }
    }
  });

  it("never derives a price without a real cost of goods", () => {
    expect(expectedRetailPrice(null, 4.5, settings).price).toBeNull();
    expect(expectedRetailPrice(Number.NaN, 4.5, settings).price).toBeNull();
    expect(expectedRetailPrice(0, 4.5, settings).price).toBeNull();
  });

  it("never derives a price without a confirmed shipping figure", () => {
    expect(expectedRetailPrice(21.79, null, settings).price).toBeNull();
    expect(expectedRetailPrice(21.79, Number.NaN, settings).price).toBeNull();
  });

  it("achieves at least the minimum markup on the rounded price after fees", () => {
    for (const [cost, shipping] of [[5, 1], [21.79, 4.5], [88.4, 9.99]] as const) {
      const { landedCost, price } = expectedRetailPrice(cost, shipping, settings);
      const fee = (price as number) * 0.02 + 0.25;
      const markup = ((price as number) - fee - (landedCost as number)) / (landedCost as number);
      expect(markup).toBeGreaterThanOrEqual(settings.target_margin);
    }
  });
});

describe("pricing exemptions", () => {
  it("has no undocumented exemptions", () => {
    for (const [id, reason] of Object.entries(APPROVED_PRICING_EXEMPTIONS)) {
      expect(id).toMatch(/^gid:\/\/shopify\/Product\/\d+$/);
      expect(reason.trim().length).toBeGreaterThan(20);
    }
  });
});
