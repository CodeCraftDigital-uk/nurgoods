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

  it("does not let one direct GB row suppress supplier US evidence", () => {
    const indexed = indexShippingEvidence(
      ["gid://shopify/Product/1"],
      [{ shopify_product_id: "gid://shopify/Product/1", market: "GB", shipping_amount: 4.24 }],
      [
        { supplier_product_id: "supplier-1", market: "GB", shipping_amount: 4.24 },
        { supplier_product_id: "supplier-1", market: "US", shipping_amount: 6.08 },
      ],
      [{ shopify_product_id: "gid://shopify/Product/1", supplier_product_id: "supplier-1" }],
    );

    expect(indexed.get("gid://shopify/Product/1")?.map((quote) => quote.market)).toEqual([
      "GB",
      "US",
    ]);
  });

  it("replaces an incomplete or stale direct row with fresher supplier evidence", () => {
    const indexed = indexShippingEvidence(
      ["gid://shopify/Product/1"],
      [
        {
          shopify_product_id: "gid://shopify/Product/1",
          market: "GB",
          shipping_amount: null,
          quoted_at: "2026-01-01T00:00:00Z",
        },
      ],
      [
        {
          supplier_product_id: "supplier-1",
          market: "GB",
          shipping_amount: 4.24,
          shipping_currency: "USD",
          quoted_at: "2026-08-01T00:00:00Z",
        },
        {
          supplier_product_id: "supplier-1",
          market: "US",
          shipping_amount: 6.08,
          shipping_currency: "USD",
          quoted_at: "2026-08-01T00:00:00Z",
        },
      ],
      [{ shopify_product_id: "gid://shopify/Product/1", supplier_product_id: "supplier-1" }],
    );

    const quotes = indexed.get("gid://shopify/Product/1") ?? [];
    expect(quotes).toHaveLength(2);
    expect(quotes[0]).toEqual(expect.objectContaining({ market: "GB", amount: 4.24 }));
    expect(quotes[1]).toEqual(expect.objectContaining({ market: "US", amount: 6.08 }));
  });

  it("prefers the newest complete quote regardless of source", () => {
    const indexed = indexShippingEvidence(
      ["gid://shopify/Product/1"],
      [
        {
          shopify_product_id: "gid://shopify/Product/1",
          market: "GB",
          shipping_amount: 9,
          quoted_at: "2026-02-01T00:00:00Z",
        },
      ],
      [
        {
          supplier_product_id: "supplier-1",
          market: "GB",
          shipping_amount: 4.24,
          quoted_at: "2026-08-20T00:00:00Z",
        },
      ],
      [{ shopify_product_id: "gid://shopify/Product/1", supplier_product_id: "supplier-1" }],
    );

    expect(indexed.get("gid://shopify/Product/1")?.[0]?.amount).toBe(4.24);
  });
});
