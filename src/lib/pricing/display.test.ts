import { describe, expect, it } from "vitest";
import {
  formatMoney,
  lineTotalDisplay,
  productPriceDisplay,
  resolvePriceDisplay,
  savingPercent,
  variantPriceDisplay,
} from "./display";

describe("formatMoney", () => {
  it("always shows minor units", () => {
    expect(formatMoney(70, "GBP")).toBe("£70.00");
    expect(formatMoney(32.99, "GBP")).toBe("£32.99");
  });

  it("falls back to store currency when none is supplied", () => {
    expect(formatMoney(10, null)).toBe("£10.00");
  });
});

describe("productPriceDisplay", () => {
  it("shows a clean range and never a compare at price alongside it", () => {
    const display = productPriceDisplay({
      price_min: 32.99,
      price_max: 122.99,
      currency: "GBP",
      compare_at_price_min: 70,
    });
    expect(display.primary).toBe("£32.99 to £122.99");
    expect(display.compareAt).toBeNull();
    expect(display.isRange).toBe(true);
  });

  it("supports a from style range", () => {
    expect(
      productPriceDisplay(
        { price_min: 32.99, price_max: 122.99, currency: "GBP" },
        { rangeStyle: "from" },
      ).primary,
    ).toBe("From £32.99");
  });

  it("shows a supplier reference price as RRP and never as a saving", () => {
    const display = productPriceDisplay({
      price_min: 24,
      price_max: 24,
      currency: "GBP",
      compare_at_price_min: 32,
    });
    expect(display.primary).toBe("£24.00");
    expect(display.compareAt).toBe("£32.00");
    expect(display.compareAtLabel).toBe("RRP");
    expect(display.isReduced).toBe(false);
    expect(display.savingPercent).toBeNull();
  });

  it("marks a genuine reduction against our own previous price", () => {
    const display = productPriceDisplay({
      price_min: 24,
      price_max: 24,
      currency: "GBP",
      compare_at_price_min: 40,
      previous_price_min: 32,
    });
    expect(display.compareAt).toBe("£32.00");
    expect(display.compareAtLabel).toBe("Was");
    expect(display.isReduced).toBe(true);
    expect(display.savingPercent).toBe(25);
  });

  it("ignores a reference price that is not above the selling price", () => {
    const display = productPriceDisplay({
      price_min: 24,
      price_max: 24,
      currency: "GBP",
      compare_at_price_min: 20,
    });
    expect(display.compareAt).toBeNull();
  });


  it("renders nothing when the store has no price", () => {
    expect(productPriceDisplay({ price_min: null, price_max: null, currency: null }).primary).toBe(
      null,
    );
  });
});

describe("variant selection", () => {
  const product = {
    price_min: 32.99,
    price_max: 122.99,
    currency: "GBP",
    compare_at_price_min: 70,
  };

  it("shows the range before a variant is chosen", () => {
    expect(resolvePriceDisplay(product, null).primary).toBe("£32.99 to £122.99");
  });

  it("replaces the range with the exact selected variant price", () => {
    const display = resolvePriceDisplay(product, { price: 122.99, compare_at_price: null });
    expect(display.primary).toBe("£122.99");
    expect(display.isRange).toBe(false);
    expect(display.compareAt).toBeNull();
  });

  it("shows the variant saving when the variant is genuinely reduced", () => {
    const display = variantPriceDisplay({ price: 35, compare_at_price: 70, currency: "GBP" });
    expect(display.primary).toBe("£35.00");
    expect(display.compareAt).toBe("£70.00");
    expect(display.savingPercent).toBe(50);
  });

  it("falls back to the range when the variant has no price", () => {
    expect(resolvePriceDisplay(product, { price: null }).primary).toBe("£32.99 to £122.99");
  });
});

describe("basket lines", () => {
  it("multiplies the exact variant price by quantity", () => {
    expect(lineTotalDisplay({ price: 32.99, currency: "GBP" }, 3).primary).toBe("£98.97");
  });

  it("treats invalid quantities as one", () => {
    expect(lineTotalDisplay({ price: 32.99, currency: "GBP" }, 0).primary).toBe("£32.99");
  });
});

describe("savingPercent", () => {
  it("returns null when there is no saving", () => {
    expect(savingPercent(50, 50)).toBeNull();
    expect(savingPercent(50, 40)).toBeNull();
  });
});

describe("advertised card and product page pricing", () => {
  it("advertises a multi price product as a From price", () => {
    const display = productPriceDisplay(
      { price_min: 12.99, price_max: 39.99, currency: "GBP" },
      { rangeStyle: "from" },
    );
    expect(display.primary).toBe("From £12.99");
    expect(display.isRange).toBe(true);
  });

  it("advertises a single price product as the exact price", () => {
    expect(
      productPriceDisplay({ price_min: 24.99, price_max: 24.99, currency: "GBP" }, { rangeStyle: "from" })
        .primary,
    ).toBe("£24.99");
  });

  it("replaces the From price with the exact selected variant price", () => {
    const product = { price_min: 12.99, price_max: 39.99, currency: "GBP" };
    expect(resolvePriceDisplay(product, null, { rangeStyle: "from" }).primary).toBe("From £12.99");
    expect(resolvePriceDisplay(product, { price: 39.99 }, { rangeStyle: "from" }).primary).toBe(
      "£39.99",
    );
  });

  it("keeps charm endings intact through formatting", () => {
    expect(formatMoney(97.99, "GBP")).toBe("£97.99");
  });
});
