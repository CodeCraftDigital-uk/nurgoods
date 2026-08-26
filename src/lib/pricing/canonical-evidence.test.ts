import { describe, expect, it } from "vitest";
import { indexShippingEvidence } from "./canonical.server";

describe("canonical shipping evidence indexing", () => {
  it("recovers supplier-keyed evidence even when a direct market row exists", () => {
    const indexed = indexShippingEvidence(
      ["gid://shopify/Product/1"],
      [{ shopify_product_id: "gid://shopify/Product/1", market: "GB", shipping_amount: 4.24 }],
      [{ supplier_product_id: "supplier-1", market: "US", shipping_amount: 6.08 }],
      [{ shopify_product_id: "gid://shopify/Product/1", supplier_product_id: "supplier-1" }],
    );

    expect(indexed.get("gid://shopify/Product/1")).toEqual([
      expect.objectContaining({ market: "GB", destination: "GB", amount: 4.24 }),
      expect.objectContaining({ market: "US", destination: "US", amount: 6.08 }),
    ]);
  });

  it("prefers direct product evidence for a duplicate market", () => {
    const indexed = indexShippingEvidence(
      ["gid://shopify/Product/1"],
      [{ shopify_product_id: "gid://shopify/Product/1", market: "GB", shipping_amount: 4.24 }],
      [{ supplier_product_id: "supplier-1", market: "GB", shipping_amount: 9 }],
      [{ shopify_product_id: "gid://shopify/Product/1", supplier_product_id: "supplier-1" }],
    );

    expect(indexed.get("gid://shopify/Product/1")?.[0]?.amount).toBe(4.24);
  });
});