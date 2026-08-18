import { describe, expect, it } from "vitest";
import { money, realisedMargin, stateLabel, stateTone } from "./presentation";

describe("order console presentation", () => {
  it("labels and tones known states", () => {
    expect(stateLabel("supplier_processing")).toBe("With the supplier");
    expect(stateTone("manual_review")).toBe("warning");
    expect(stateTone("delivered")).toBe("positive");
    expect(stateTone("unknown_state")).toBe("neutral");
  });

  it("never invents a currency", () => {
    expect(money(null, "GBP")).toBe("Not recorded");
    expect(money(5.61, null)).toContain("currency not recorded");
    expect(money(8.99, "GBP")).toContain("8.99");
  });

  it("refuses to compare amounts across currencies", () => {
    const result = realisedMargin({
      orderTotal: 8.99,
      orderCurrency: "GBP",
      supplierTotal: 5.61,
      supplierCurrency: "USD",
    });
    expect(result.comparable).toBe(false);
  });

  it("compares when the supplier payment is in the order currency", () => {
    const result = realisedMargin({
      orderTotal: 8.99,
      orderCurrency: "GBP",
      supplierTotal: 5.61,
      supplierCurrency: "USD",
      paymentAmount: 4.27,
      paymentCurrency: "GBP",
    });
    expect(result.comparable).toBe(true);
    expect(result.label).toContain("4.72");
  });
});
