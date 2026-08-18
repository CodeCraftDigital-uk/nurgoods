import { describe, expect, it } from "vitest";
import {
  computeEconomics,
  effectiveFxRate,
  marginAtPrice,
  reconcileOrderEconomics,
  requiredPrice,
  settingsAreUsable,
} from "./economics";
import { assessShippingEvidence } from "./shipping-evidence";

const FEE = { variable: 0.02, fixed: 0.25 };

const BASE = {
  supplierItemCost: 5.61,
  supplierShippingCost: 4.32,
  referenceFxRate: 0.78,
  fxBufferPct: 0.04,
  targetMargin: 0.6,
  fee: FEE,
  roundingMode: "charm_99" as const,
  promoDiscount: 0.2,
  minPromoMargin: 0.35,
};

describe("protected exchange rate", () => {
  it("always prices at a worse rate than the reference", () => {
    expect(effectiveFxRate(0.78, 0.04)).toBeCloseTo(0.8112, 6);
    expect(effectiveFxRate(0.78, 0.04)).toBeGreaterThan(0.78);
  });

  it("leaves the rate untouched when the buffer is zero", () => {
    expect(effectiveFxRate(0.78, 0)).toBe(0.78);
  });
});

describe("required price", () => {
  it("solves the price that holds the target margin after both fee parts", () => {
    const price = requiredPrice({ landedCogs: 8.06, fee: FEE, targetMargin: 0.6 });
    expect(price).not.toBeNull();
    const margin = marginAtPrice(price as number, 8.06, FEE);
    expect(margin).toBeCloseTo(0.6, 4);
  });

  it("refuses settings where the fee and the target consume the whole price", () => {
    expect(requiredPrice({ landedCogs: 5, fee: { variable: 0.45, fixed: 0.2 }, targetMargin: 0.6 }))
      .toBeNull();
    expect(settingsAreUsable(0.98, FEE)).toBe(false);
    expect(settingsAreUsable(0.6, { variable: 1.2, fixed: 0 })).toBe(false);
  });
});

describe("economics", () => {
  it("converts the supplier landed cost at the protected rate", () => {
    const result = computeEconomics(BASE);
    expect(result.complete).toBe(true);
    expect(result.supplierLandedTotalSource).toBeCloseTo(9.93, 2);
    expect(result.effectiveFxRate).toBeCloseTo(0.8112, 4);
    expect(result.protectedLandedCogs).toBeCloseTo(8.06, 2);
  });

  it("rounds upwards only, so the advertised price never falls under the requirement", () => {
    const result = computeEconomics(BASE);
    expect(result.advertisedPrice).not.toBeNull();
    expect(result.advertisedPrice as number).toBeGreaterThanOrEqual(result.requiredPrice as number);
    expect(String(result.advertisedPrice).endsWith(".99")).toBe(true);
    expect(result.expectedMargin as number).toBeGreaterThanOrEqual(0.6);
  });

  it("keeps the expected payout and profit consistent with the fee model", () => {
    const result = computeEconomics(BASE);
    const price = result.advertisedPrice as number;
    expect(result.expectedFee).toBeCloseTo(
      Math.round((price * FEE.variable + FEE.fixed) * 100) / 100,
      2,
    );
    expect(result.expectedPayout).toBeCloseTo(price - (result.expectedFee as number), 2);
    expect(result.expectedProfit).toBeCloseTo(
      (result.expectedPayout as number) - (result.protectedLandedCogs as number),
      2,
    );
  });

  it("does not convert a cost that is already held in the selling currency", () => {
    const result = computeEconomics({
      ...BASE,
      supplierItemCost: 4.5,
      itemCostIsSettlementCurrency: true,
      supplierShippingCost: 4.32,
    });
    expect(result.supplierLandedTotalSource).toBeCloseTo(4.32, 2);
    expect(result.protectedLandedCogs).toBeCloseTo(4.5 + 4.32 * 0.8112, 2);
  });

  it("reports the promotional price against the margin floor", () => {
    const result = computeEconomics(BASE);
    expect(result.promoMargin).not.toBeNull();
    expect(result.promoWithinFloor).toBe((result.promoMargin as number) >= 0.35);
  });

  it("fails closed without shipping evidence", () => {
    const result = computeEconomics({ ...BASE, supplierShippingCost: null });
    expect(result.complete).toBe(false);
    expect(result.advertisedPrice).toBeNull();
    expect(result.reason).toBeTruthy();
  });

  it("fails closed without an exchange rate", () => {
    const result = computeEconomics({ ...BASE, referenceFxRate: null });
    expect(result.complete).toBe(false);
    expect(result.protectedLandedCogs).toBeNull();
  });

  it("never treats a missing shipping figure as zero", () => {
    const missing = computeEconomics({ ...BASE, supplierShippingCost: null });
    const zero = computeEconomics({ ...BASE, supplierShippingCost: 0 });
    expect(missing.advertisedPrice).toBeNull();
    expect(zero.advertisedPrice).not.toBeNull();
  });
});

describe("shipping evidence policy", () => {
  const now = new Date("2026-01-20T12:00:00Z");
  const policy = { market: "GB", maxAgeDays: 14, now };
  const good = {
    amount: 4.32,
    currency: "USD",
    destination: "GB",
    service: "supplier standard",
    quotedAt: "2026-01-18T12:00:00Z",
  };

  it("accepts a dated destination quote for the configured market", () => {
    const result = assessShippingEvidence(good, policy);
    expect(result.usable).toBe(true);
    expect(result.amount).toBe(4.32);
  });

  it("rejects the legacy figure that has no destination or service", () => {
    const result = assessShippingEvidence(
      { amount: 2.49, currency: "GBP", destination: null, service: null, quotedAt: null },
      policy,
    );
    expect(result.usable).toBe(false);
    expect(result.status).toBe("ambiguous");
  });

  it("rejects a quote for another destination", () => {
    expect(assessShippingEvidence({ ...good, destination: "US" }, policy).status).toBe(
      "wrong_destination",
    );
  });

  it("rejects a quote older than the policy", () => {
    const result = assessShippingEvidence({ ...good, quotedAt: "2025-11-01T12:00:00Z" }, policy);
    expect(result.status).toBe("stale");
    expect(result.usable).toBe(false);
  });

  it("rejects a missing quote", () => {
    expect(assessShippingEvidence({ ...good, amount: null }, policy).status).toBe("missing");
  });
});

describe("order reconciliation", () => {
  // The real first order: GBP 8.99 taken, GBP 0.43 fee, GBP 8.56 paid out,
  // USD 5.61 charged by the supplier for the goods.
  it("derives the payout when only the gross and the fee are known", () => {
    const result = reconcileOrderEconomics({
      grossPayment: 8.99,
      paymentFee: 0.43,
      payout: null,
      supplierCostSource: 5.61,
      supplierCostSettlement: null,
    });
    expect(result.evidenced).toBe(false);
    expect(result.realisedProfit).toBeNull();
    expect(result.note).toBeTruthy();
  });

  it("states the realised profit, margin and exchange rate once the charge is known", () => {
    const result = reconcileOrderEconomics({
      grossPayment: 8.99,
      paymentFee: 0.43,
      payout: 8.56,
      supplierCostSource: 5.61,
      supplierCostSettlement: 4.27,
      forecastProfit: 4.0,
    });
    expect(result.evidenced).toBe(true);
    expect(result.realisedProfit).toBeCloseTo(4.29, 2);
    expect(result.realisedMargin).toBeCloseTo(0.4772, 3);
    expect(result.realisedFxRate).toBeCloseTo(0.761141, 5);
    expect(result.profitVariance).toBeCloseTo(0.29, 2);
  });

  it("never invents a supplier settlement figure", () => {
    const result = reconcileOrderEconomics({
      grossPayment: 8.99,
      paymentFee: 0.43,
      payout: 8.56,
      supplierCostSource: 5.61,
      supplierCostSettlement: null,
    });
    expect(result.realisedProfit).toBeNull();
    expect(result.realisedFxRate).toBeNull();
  });
});
