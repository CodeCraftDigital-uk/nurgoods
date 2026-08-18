import { describe, expect, it } from "vitest";
import { dispatchKey, linkageDecision, paymentEvidence, supplierStatusToState } from "./types";
import { normaliseOrderPayload, verifyStoreSignature } from "./webhook";
import { processFulfilmentQueue } from "./orchestrator";
import type { LedgerPort, SupplierPort } from "./ports";
import { createHmac } from "crypto";
import { DEFAULT_COMMERCE_SETTINGS, type CommerceSettings, type OrderRecord } from "./types";

describe("payment evidence", () => {
  it("refuses anything the store has not reported as paid", () => {
    expect(paymentEvidence({ financialStatus: "pending" }).paid).toBe(false);
    expect(paymentEvidence({ financialStatus: "authorized" }).paid).toBe(false);
    expect(paymentEvidence({ financialStatus: null }).paid).toBe(false);
    expect(paymentEvidence({ financialStatus: "partially_paid" }).paid).toBe(false);
  });

  it("accepts a paid order and queues it for the supplier", () => {
    const result = paymentEvidence({ financialStatus: "paid" });
    expect(result.paid).toBe(true);
    expect(result.state).toBe("awaiting_supplier_order");
  });

  it("treats refunds, voids and cancellations as cancelled", () => {
    expect(paymentEvidence({ financialStatus: "refunded" }).state).toBe("cancelled");
    expect(paymentEvidence({ financialStatus: "voided" }).state).toBe("cancelled");
    expect(paymentEvidence({ financialStatus: "paid", cancelledAt: "2026-01-01" }).state).toBe("cancelled");
  });

  it("refuses a paid order that still owes money", () => {
    expect(paymentEvidence({ financialStatus: "paid", totalOutstanding: 4.5 }).paid).toBe(false);
  });
});

describe("supplier linkage", () => {
  const candidates = [
    { id: 11, orderNumber: "1042", status: "processing" },
    { id: 12, orderNumber: "1043", status: "processing" },
  ];

  it("links on an exact store order number", () => {
    const decision = linkageDecision({ candidates, storeOrderNumber: 1043, storeOrderName: "#1043" });
    expect(decision.ok).toBe(true);
    expect(decision.supplierOrderId).toBe(12);
  });

  it("waits when nothing matches", () => {
    const decision = linkageDecision({ candidates, storeOrderNumber: 9999, storeOrderName: "#9999" });
    expect(decision.ok).toBe(false);
    expect(decision.state).toBe("awaiting_supplier_order");
  });

  it("escalates an ambiguous match instead of guessing", () => {
    const decision = linkageDecision({
      candidates: [
        { id: 1, orderNumber: "1042", status: "processing" },
        { id: 2, orderNumber: "1042", status: "processing" },
      ],
      storeOrderNumber: 1042,
      storeOrderName: "#1042",
    });
    expect(decision.state).toBe("manual_review");
  });

  it("never re-fulfils a supplier order that already shipped", () => {
    const decision = linkageDecision({
      candidates: [{ id: 3, orderNumber: "1042", status: "shipped" }],
      storeOrderNumber: 1042,
      storeOrderName: null,
    });
    expect(decision.ok).toBe(false);
    expect(decision.state).toBe("supplier_processing");
  });
});

describe("supplier status mapping", () => {
  it("maps the states NUR GOODS acts on", () => {
    expect(supplierStatusToState("Shipped")).toBe("shipped");
    expect(supplierStatusToState("delivered")).toBe("delivered");
    expect(supplierStatusToState("out_of_stock")).toBe("out_of_stock");
    expect(supplierStatusToState("rejected")).toBe("supplier_rejected");
    expect(supplierStatusToState("something new")).toBeNull();
  });
});

describe("store webhook", () => {
  it("only accepts a signature over the exact raw body", () => {
    const secret = "test-secret";
    const body = JSON.stringify({ id: 1 });
    const signature = createHmac("sha256", secret).update(body, "utf8").digest("base64");
    expect(verifyStoreSignature(body, signature, secret)).toBe(true);
    expect(verifyStoreSignature(`${body} `, signature, secret)).toBe(false);
    expect(verifyStoreSignature(body, "nope", secret)).toBe(false);
    expect(verifyStoreSignature(body, signature, "")).toBe(false);
  });

  it("normalises only the fields the ledger needs", () => {
    const order = normaliseOrderPayload({
      id: 55,
      name: "#1042",
      order_number: 1042,
      financial_status: "paid",
      currency: "GBP",
      total_price: "42.99",
      line_items: [{ id: 9, variant_id: 7, product_id: 8, sku: "A1", title: "Thing", quantity: 2, price: "21.49" }],
    });
    expect(order?.shopifyOrderId).toBe("gid://shopify/Order/55");
    expect(order?.lines[0]?.shopifyVariantId).toBe("gid://shopify/ProductVariant/7");
    expect(order?.total).toBe(42.99);
  });
});

/* ------------------------------- queue tests ------------------------------ */

function makeOrder(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    id: "order-1",
    shopify_order_id: "gid://shopify/Order/55",
    shopify_order_name: "#1042",
    shopify_order_number: 1042,
    shopify_financial_status: "paid",
    shopify_fulfillment_status: null,
    currency: "GBP",
    order_total: 42.99,
    zendrop_store_id: null,
    zendrop_order_id: null,
    zendrop_fulfillment_operation_id: null,
    orchestration_state: "awaiting_supplier_order",
    supplier_status: null,
    tracking_number: null,
    tracking_carrier: null,
    tracking_url: null,
    preview_at: null,
    preview_is_credit_redeem: false,
    dispatch_idempotency_key: null,
    retry_count: 0,
    paid_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeLedger(
  orders: OrderRecord[],
  settings: Partial<CommerceSettings> = {},
  lines: any[] = [STORE_LINE],
) {
  const patches: Record<string, unknown>[] = [];
  const linked: any[] = [];
  const ledger: LedgerPort = {
    async claim() {
      return orders;
    },
    async lines() {
      return lines;
    },
    async linkLines(_id, mappings) {
      linked.push(...mappings);
    },
    async update(_id, patch) {
      patches.push(patch);
      Object.assign(orders[0]!, patch);
    },
    async event() {},
    async settings() {
      return { ...DEFAULT_COMMERCE_SETTINGS, ...settings };
    },
  };
  return { ledger, patches, linked };
}

const STORE_LINE = {
  id: "line-1",
  shopify_line_item_id: "9001",
  shopify_variant_id: "5001",
  shopify_product_id: "4001",
  sku: "NG-001",
  quantity: 1,
};

const SUPPLIER_LINE = { variantId: "5001", productId: "4001", sku: "NG-001", quantity: 1, raw: {} };

function makeSupplier(calls: string[], supplierLines: any[] = [SUPPLIER_LINE]): SupplierPort {
  return {
    async available() {
      return { ready: true, missing: [] };
    },
    async storeId() {
      return 5;
    },
    async listOrders() {
      calls.push("list");
      return [{ id: 77, orderNumber: "1042", name: "#1042", status: "processing" }];
    },
    async getOrder() {
      calls.push("getOrder");
      return {
        id: 77,
        orderNumber: "1042",
        name: "#1042",
        status: "processing",
        lines: supplierLines,
      };
    },
    async quoteFulfilmentCost() {
      calls.push("quote");
      return { productCost: 10, shippingCost: 2, totalCost: 12, currency: "GBP", reference: null, raw: {} };
    },
    async previewFulfilment() {
      calls.push("preview");
      return { productCost: 10, shippingCost: 2, totalCost: 12, currency: "GBP", reference: "quote-1", raw: {} };
    },
    async confirmFulfilment() {
      calls.push("confirm");
      return { id: "op-1", status: "completed", terminal: true, succeeded: true, message: null };
    },
    async getOperation() {
      return { id: "op-1", status: "completed", terminal: true, succeeded: true, message: null };
    },
    async getTracking() {
      return { status: null, trackingNumber: null, trackingUrl: null, carrier: null, events: [] };
    },
  };
}

describe("fulfilment queue", () => {
  it("quotes but never dispatches while automatic fulfilment is off", async () => {
    const calls: string[] = [];
    const { ledger } = makeLedger([makeOrder()]);
    const summary = await processFulfilmentQueue(ledger, makeSupplier(calls));
    expect(calls).toEqual(["list", "getOrder", "preview"]);
    expect(summary.dispatched).toBe(0);
    expect(summary.previewed).toBe(1);
  });

  it("dispatches once fulfilment is authorised", async () => {
    const calls: string[] = [];
    const { ledger } = makeLedger([makeOrder()], { auto_fulfilment_enabled: true });
    const summary = await processFulfilmentQueue(ledger, makeSupplier(calls));
    expect(calls).toContain("confirm");
    expect(summary.dispatched).toBe(1);
  });

  it("never dispatches the same order twice", async () => {
    const calls: string[] = [];
    const order = makeOrder({
      orchestration_state: "awaiting_fulfilment_confirmation",
      zendrop_order_id: 77,
      zendrop_store_id: 5,
      dispatch_idempotency_key: dispatchKey("gid://shopify/Order/55", 77),
    });
    const { ledger } = makeLedger([order], { auto_fulfilment_enabled: true });
    const summary = await processFulfilmentQueue(ledger, makeSupplier(calls));
    expect(calls).not.toContain("confirm");
    expect(summary.dispatched).toBe(0);
    expect(summary.skipped).toBe(1);
  });

  it("stops entirely when the supplier account cannot fulfil", async () => {
    const calls: string[] = [];
    const supplier = { ...makeSupplier(calls), available: async () => ({ ready: false, missing: ["order_fulfil"] }) };
    const { ledger } = makeLedger([makeOrder()], { auto_fulfilment_enabled: true });
    const summary = await processFulfilmentQueue(ledger, supplier as SupplierPort);
    expect(calls).toEqual([]);
    expect(summary.considered).toBe(0);
  });
});
