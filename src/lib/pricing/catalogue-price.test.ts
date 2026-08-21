import { describe, expect, it } from "vitest";
import { charmUp, computeCataloguePrice } from "./catalogue-price";

const fee = { feeVariable: 0.02, feeFixed: 0.25 };

describe("catalogue pricing v4", () => {
  it("prices the reference t-shirt at 67.99", () => {
    const result = computeCataloguePrice({ unitCost: 41.09, ...fee });
    expect(result.complete).toBe(true);
    expect(result.rawPrice).toBeCloseTo(67.34, 2);
    expect(result.price).toBe(67.99);
  });

  it("always rounds up to a price ending .99", () => {
    for (const cost of [1, 2.5, 7.77, 12.34, 41.09, 99.99]) {
      const { price } = computeCataloguePrice({ unitCost: cost, ...fee });
      expect(Math.round(price! * 100) % 100).toBe(99);
      const raw = computeCataloguePrice({ unitCost: cost, ...fee }).rawPrice!;
      expect(price!).toBeGreaterThanOrEqual(raw - 1e-9);
    }
  });

  it("never rounds down below the raw price", () => {
    expect(charmUp(67.99)).toBe(67.99);
    expect(charmUp(67.995)).toBe(68.99);
    expect(charmUp(0.5)).toBe(0.99);
  });

  it("holds rather than guesses when cost is missing or zero", () => {
    expect(computeCataloguePrice({ unitCost: null, ...fee }).complete).toBe(false);
    expect(computeCataloguePrice({ unitCost: 0, ...fee }).complete).toBe(false);
  });

  it("ignores supplier shipping entirely", () => {
    const a = computeCataloguePrice({ unitCost: 10, ...fee });
    const b = computeCataloguePrice({ unitCost: 10, markup: 1.6, ...fee });
    expect(a.price).toBe(b.price);
  });
});
