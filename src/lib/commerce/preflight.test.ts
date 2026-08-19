import { describe, expect, it } from "vitest";
import { supplierPreflightDecision, type PreflightLine, type PreflightLink } from "./preflight";

const NOW = Date.parse("2026-08-19T06:00:00.000Z");
const FRESH = "2026-08-19T04:00:00.000Z";
const OLD = "2026-08-10T04:00:00.000Z";

function line(overrides?: Partial<PreflightLine>): PreflightLine {
  return {
    shopifyVariantId: "gid://shopify/ProductVariant/1",
    shopifyProductId: "gid://shopify/Product/1",
    quantity: 1,
    title: "Test line",
    ...overrides,
  };
}

function link(overrides?: Partial<PreflightLink>): PreflightLink {
  return {
    shopifyProductId: "gid://shopify/Product/1",
    syncState: "healthy",
    lastSyncAt: FRESH,
    manualHold: false,
    landedCost: 6.4,
    variantMap: [{ store_variant_id: "gid://shopify/ProductVariant/1", sku: "SKU-1" }],
    blockedVariantSkus: [],
    ...overrides,
  };
}

describe("supplierPreflightDecision", () => {
  it("clears an order whose lines all map to current supplier facts", () => {
    const decision = supplierPreflightDecision({ lines: [line()], links: [link()], now: NOW });
    expect(decision.ok).toBe(true);
    expect(decision.code).toBe("preflight_clear");
  });

  it("refuses an order with no lines", () => {
    const decision = supplierPreflightDecision({ lines: [], links: [link()], now: NOW });
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("preflight_no_lines");
  });

  it("refuses an unmapped variant", () => {
    const decision = supplierPreflightDecision({
      lines: [line({ shopifyVariantId: "gid://shopify/ProductVariant/99" })],
      links: [link()],
      now: NOW,
    });
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("preflight_unmapped_variant");
  });

  it("refuses a product with no supplier link at all", () => {
    const decision = supplierPreflightDecision({ lines: [line()], links: [], now: NOW });
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("preflight_unmapped_variant");
  });

  it("refuses stale supplier facts even when the sync state looks healthy", () => {
    const decision = supplierPreflightDecision({
      lines: [line()],
      links: [link({ lastSyncAt: OLD })],
      now: NOW,
    });
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("preflight_stale_supplier_facts");
  });

  it("refuses a listing on a supplier hold", () => {
    const decision = supplierPreflightDecision({
      lines: [line()],
      links: [link({ syncState: "held_unavailable" })],
      now: NOW,
    });
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("preflight_supplier_hold");
  });

  it("refuses a manual hold", () => {
    const decision = supplierPreflightDecision({
      lines: [line()],
      links: [link({ manualHold: true })],
      now: NOW,
    });
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("preflight_supplier_hold");
  });

  it("refuses an ambiguous landed cost", () => {
    const decision = supplierPreflightDecision({
      lines: [line()],
      links: [link({ landedCost: null })],
      now: NOW,
    });
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("preflight_ambiguous_cost");
  });

  it("refuses a variant the supplier reports as unsellable", () => {
    const decision = supplierPreflightDecision({
      lines: [line()],
      links: [link({ blockedVariantSkus: ["SKU-1"] })],
      now: NOW,
    });
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("preflight_out_of_stock");
  });

  it("refuses a non positive quantity", () => {
    const decision = supplierPreflightDecision({
      lines: [line({ quantity: 0 })],
      links: [link()],
      now: NOW,
    });
    expect(decision.ok).toBe(false);
    expect(decision.code).toBe("preflight_quantity");
  });

  it("matches a bare stored variant reference against a full store reference", () => {
    const decision = supplierPreflightDecision({
      lines: [line()],
      links: [
        link({
          shopifyProductId: "1",
          variantMap: [{ store_variant_id: "1", sku: "SKU-1" }],
        }),
      ],
      now: NOW,
    });
    expect(decision.ok).toBe(true);
    expect(decision.code).toBe("preflight_clear");
  });
});
