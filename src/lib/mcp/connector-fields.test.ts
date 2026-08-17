import { describe, expect, it } from "vitest";
import {
  findForbiddenKey,
  projectDetail,
  projectSummary,
} from "@/lib/public-api/connector-fields";

/** A record shaped like the internal one, deliberately carrying private fields. */
const internalRow = {
  id: "row-uuid",
  shopify_product_id: "gid://shopify/Product/1",
  handle: "wooden-desk-organizer-set",
  title: "Wooden Desk Organizer Set",
  summary: "A tidy oak desk set.",
  description: "Public shopper facing description.",
  product_type: "Desk accessories",
  vendor: "NUR GOODS",
  tags: ["home", "office"],
  featured_image_url: "https://cdn.example/a.jpg",
  price_min: 34.99,
  price_max: 54.99,
  currency: "GBP",
  available_for_sale: true,
  variant_count: 3,
  unit_cost: 12.4,
  cost_source: "supplier_feed",
  supplier_url: "https://supplier.example/item/1",
  margin_target: 0.6,
  raw: { everything: "internal" },
  internal_notes: "do not show",
  quality_score: 82,
  duplicate_of: "other-uuid",
  category_path: [{ slug: "home", name: "Home" }, { slug: "desk", name: "Desk" }],
  collections: [{ handle: "office", title: "Office" }],
  media: [{ url: "https://cdn.example/a.jpg", alt: "Oak tray" }],
  options: [{ name: "Finish", values: ["Oak", "Walnut"] }],
  variants: [
    {
      id: "v1",
      shopify_variant_id: "gid://shopify/ProductVariant/9",
      title: "Oak",
      price: 34.99,
      currency: "GBP",
      selected_options: [{ name: "Finish", value: "Oak" }],
      available_for_sale: true,
      image_url: null,
      unit_cost: 11.1,
    },
    {
      id: "v2",
      title: "Walnut",
      price: 54.99,
      currency: "GBP",
      selected_options: [{ name: "Finish", value: "Walnut" }],
      available_for_sale: false,
      image_url: null,
    },
  ],
  updated_at: "2026-08-01T10:00:00.000Z",
};

const url = "https://nurgoods.com/shop/wooden-desk-organizer-set";

describe("connector field allowlisting", () => {
  it("emits only public merchandising fields for a summary", () => {
    const summary = projectSummary(internalRow, url);
    expect(Object.keys(summary).sort()).toEqual(
      [
        "available",
        "brand",
        "category",
        "currency",
        "handle",
        "image_url",
        "price_from",
        "price_to",
        "product_type",
        "product_url",
        "summary",
        "tags",
        "title",
        "variant_count",
      ].sort(),
    );
    expect(findForbiddenKey(summary)).toBeNull();
  });

  it("never leaks cost, supplier, margin, raw payload or internal scoring", () => {
    const detail = projectDetail(internalRow, url);
    const serialised = JSON.stringify(detail);
    for (const secret of [
      "unit_cost",
      "cost_source",
      "supplier_url",
      "margin_target",
      "internal_notes",
      "quality_score",
      "duplicate_of",
      "shopify_product_id",
      "gid://shopify",
      "row-uuid",
      "12.4",
      "11.1",
    ]) {
      expect(serialised).not.toContain(secret);
    }
    expect(findForbiddenKey(detail)).toBeNull();
  });

  it("returns the public product page rather than an internal identifier", () => {
    const detail = projectDetail(internalRow, url);
    expect(detail.product_url).toBe(url);
    expect(detail).not.toHaveProperty("id");
  });

  it("describes only variants a shopper can actually buy", () => {
    const detail = projectDetail(internalRow, url);
    expect(detail.variants).toHaveLength(1);
    expect(detail.variants[0]).toEqual({
      title: "Oak",
      options: [{ name: "Finish", value: "Oak" }],
      price: 34.99,
      currency: "GBP",
      available: true,
      image_url: null,
    });
  });

  it("keeps a single sold out variant so pricing is still answerable", () => {
    const detail = projectDetail(
      { ...internalRow, variants: [{ title: "Default", price: 19.99, available_for_sale: false }] },
      url,
    );
    expect(detail.variants).toHaveLength(1);
    expect(detail.variants[0]?.available).toBe(false);
  });

  it("flags a forbidden key anywhere in a nested payload", () => {
    expect(findForbiddenKey({ items: [{ ok: 1, unit_cost: 2 }] })).toBe("items[0].unit_cost");
  });
});
