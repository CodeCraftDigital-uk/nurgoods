import { describe, expect, it } from "vitest";
import { readSupplierStock, saleabilityFromStock } from "./variant-stock";

describe("readSupplierStock", () => {
  it("reports no signal for the payloads the connected supplier plan actually returns", () => {
    const reading = readSupplierStock({
      catalogueProduct: { inventory: null },
      catalogueVariants: [],
      storeVariants: [
        {
          store_variant_id: "62968607015242",
          variant_title: "Magnetic Neck Support Strap",
          variant_sku: "1775427141105291265",
          variant_price: null,
        },
      ],
    });
    expect(reading.signal).toBe("none");
    expect(reading.variants).toHaveLength(1);
    expect(reading.variants[0]!.storeVariantId).toBe("62968607015242");
    expect(reading.variants[0]!.quantity).toBeNull();
  });

  it("picks up availability flags without inventing quantities", () => {
    const reading = readSupplierStock({
      catalogueProduct: { inventory: null },
      catalogueVariants: [{ sku: "A", available: false }, { sku: "B", available: true }],
      storeVariants: [],
    });
    expect(reading.signal).toBe("availability");
    expect(reading.variants.every((variant) => variant.quantity === null)).toBe(true);
  });

  it("picks up genuine quantities when the supplier provides them", () => {
    const reading = readSupplierStock({
      catalogueProduct: { inventory: 12 },
      catalogueVariants: [{ sku: "A", quantity: 4 }],
      storeVariants: [{ variant_sku: "A", store_variant_id: "999" }],
    });
    expect(reading.signal).toBe("quantity");
    expect(reading.variants[0]!.quantity).toBe(4);
    expect(reading.variants[0]!.storeVariantId).toBe("999");
  });
});

describe("saleabilityFromStock", () => {
  it("does not block when the supplier gives no stock signal", () => {
    const reading = readSupplierStock({ catalogueProduct: { inventory: null } });
    const verdict = saleabilityFromStock(reading);
    expect(verdict.sellable).toBe(true);
    expect(verdict.blockedVariantSkus).toEqual([]);
  });

  it("blocks the product when every variant is out of stock", () => {
    const reading = readSupplierStock({
      catalogueVariants: [{ sku: "A", available: false }, { sku: "B", available: false }],
    });
    expect(saleabilityFromStock(reading).sellable).toBe(false);
  });

  it("blocks only the unavailable variant when others are healthy", () => {
    const reading = readSupplierStock({
      catalogueVariants: [{ sku: "A", available: false }, { sku: "B", available: true }],
    });
    const verdict = saleabilityFromStock(reading);
    expect(verdict.sellable).toBe(true);
    expect(verdict.blockedVariantSkus).toEqual(["A"]);
  });

  it("blocks on a zero product quantity", () => {
    const reading = readSupplierStock({ catalogueProduct: { inventory: 0 } });
    expect(saleabilityFromStock(reading).sellable).toBe(false);
  });
});
