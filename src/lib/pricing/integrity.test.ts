import { describe, expect, it } from "vitest";
import { endsInCharm99, expectedRetailPrice, APPROVED_PRICING_EXEMPTIONS } from "./integrity.server";

const settings = { target_margin: 0.6, rounding_mode: "charm_99" as const };

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
  it("applies landed cost divided by one minus the target margin", () => {
    const result = expectedRetailPrice(21.79, 4.5, settings);
    expect(result.landedCost).toBe(26.29);
    // 26.29 / 0.4 = 65.725, rounded up to the next charm price
    expect(result.rawPrice).toBeCloseTo(65.73, 1);
    expect(result.price).toBe(65.99);
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
  });

  it("never derives a price without a confirmed shipping figure", () => {
    expect(expectedRetailPrice(21.79, null, settings).price).toBeNull();
    expect(expectedRetailPrice(21.79, Number.NaN, settings).price).toBeNull();
  });

  it("refuses to price against an invalid target margin", () => {
    expect(expectedRetailPrice(10, 2, { target_margin: 0, rounding_mode: "charm_99" }).price).toBeNull();
    expect(expectedRetailPrice(10, 2, { target_margin: 1, rounding_mode: "charm_99" }).price).toBeNull();
    expect(expectedRetailPrice(10, 2, { target_margin: 1.5, rounding_mode: "charm_99" }).price).toBeNull();
  });

  it("achieves at least the target gross margin on the rounded price", () => {
    for (const [cost, shipping] of [[5, 1], [21.79, 4.5], [88.4, 9.99]] as const) {
      const { landedCost, price } = expectedRetailPrice(cost, shipping, settings);
      const margin = ((price as number) - (landedCost as number)) / (price as number);
      expect(margin).toBeGreaterThanOrEqual(settings.target_margin);
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
