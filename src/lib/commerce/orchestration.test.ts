import { describe, expect, it } from "vitest";
import {
  PREVIEW_TTL_MS,
  classifySupplierStatus,
  dispatchKey,
  lineLinkageDecision,
  linkageDecision,
  paymentEvidence,
  previewScope,
  previewValidity,
  supplierStatusToState,
} from "./types";
import { normaliseOrderPayload, verifyStoreSignature } from "./webhook";
import { DELIVERY_LEASE_MS, claimDelivery, type DeliveryRow, type DeliveryStore } from "./ledger.server";
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

  it("treats Unfulfilled as work still to do, never as fulfilled", () => {
    const decision = linkageDecision({
      candidates: [{ id: 4, orderNumber: "1002", status: "Unfulfilled" }],
      storeOrderNumber: 1002,
      storeOrderName: "#1002",
    });
    expect(decision.ok).toBe(true);
    expect(decision.supplierOrderId).toBe(4);
    expect(decision.state).toBe("awaiting_fulfilment_preview");
  });

  it("holds a partly fulfilled supplier order for a person", () => {
    const decision = linkageDecision({
      candidates: [{ id: 5, orderNumber: "1002", status: "Partially Fulfilled" }],
      storeOrderNumber: 1002,
      storeOrderName: null,
    });
    expect(decision.ok).toBe(false);
    expect(decision.state).toBe("manual_review");
  });

  it("stops on a cancelled or rejected supplier order", () => {
    expect(
      linkageDecision({
        candidates: [{ id: 6, orderNumber: "1002", status: "Cancelled" }],
        storeOrderNumber: 1002,
        storeOrderName: null,
      }).state,
    ).toBe("cancelled");
    expect(
      linkageDecision({
        candidates: [{ id: 7, orderNumber: "1002", status: "Rejected" }],
        storeOrderNumber: 1002,
        storeOrderName: null,
      }).state,
    ).toBe("supplier_rejected");
  });
});

describe("supplier status classification", () => {
  it("classifies supplier statuses word by word", () => {
    expect(classifySupplierStatus("Unfulfilled")).toBe("pending");
    expect(classifySupplierStatus("unshipped")).toBe("pending");
    expect(classifySupplierStatus("Not yet shipped")).toBe("pending");
    expect(classifySupplierStatus("Fulfilled")).toBe("fulfilled");
    expect(classifySupplierStatus("Partially Fulfilled")).toBe("partially_fulfilled");
    expect(classifySupplierStatus("Processing")).toBe("processing");
    expect(classifySupplierStatus("Cancelled")).toBe("cancelled");
    expect(classifySupplierStatus("Shipped")).toBe("shipped");
    expect(classifySupplierStatus("In transit")).toBe("shipped");
    expect(classifySupplierStatus("Delivered")).toBe("delivered");
    expect(classifySupplierStatus("out_of_stock")).toBe("out_of_stock");
    expect(classifySupplierStatus("Rejected")).toBe("rejected");
    expect(classifySupplierStatus("")).toBe("unknown");
    expect(classifySupplierStatus(null)).toBe("unknown");
    expect(classifySupplierStatus("something new")).toBe("unknown");
  });
});

describe("supplier status mapping", () => {
  it("maps the states NUR GOODS acts on", () => {
    expect(supplierStatusToState("Shipped")).toBe("shipped");
    expect(supplierStatusToState("delivered")).toBe("delivered");
    expect(supplierStatusToState("out_of_stock")).toBe("out_of_stock");
    expect(supplierStatusToState("rejected")).toBe("supplier_rejected");
    expect(supplierStatusToState("Unfulfilled")).toBe("supplier_processing");
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

function healthyLink(overrides: Record<string, unknown> = {}) {
  return {
    shopifyProductId: "4001",
    syncState: "healthy",
    lastSyncAt: new Date().toISOString(),
    manualHold: false,
    landedCost: 4.2,
    variantMap: [{ store_variant_id: "5001", sku: "NG-001" }],
    blockedVariantSkus: [],
    ...overrides,
  };
}

function makeLedger(
  orders: OrderRecord[],
  settings: Partial<CommerceSettings> = {},
  lines: any[] = [STORE_LINE],
  health: any[] = [healthyLink()],
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
    async supplierHealth() {
      return health;
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

  it("refuses to dispatch against stale supplier facts", async () => {
    const calls: string[] = [];
    const stale = new Date(Date.now() - 200 * 3_600_000).toISOString();
    const { ledger } = makeLedger([makeOrder()], { auto_fulfilment_enabled: true }, [STORE_LINE], [
      healthyLink({ lastSyncAt: stale }),
    ]);
    const summary = await processFulfilmentQueue(ledger, makeSupplier(calls));
    expect(calls).not.toContain("confirm");
    expect(summary.dispatched).toBe(0);
  });

  it("refuses to dispatch a variant with no supplier mapping", async () => {
    const calls: string[] = [];
    const { ledger } = makeLedger([makeOrder()], { auto_fulfilment_enabled: true }, [STORE_LINE], [
      healthyLink({ variantMap: [] }),
    ]);
    const summary = await processFulfilmentQueue(ledger, makeSupplier(calls));
    expect(calls).not.toContain("confirm");
    expect(summary.dispatched).toBe(0);
  });

  it("refuses to dispatch a listing on a supplier hold", async () => {
    const calls: string[] = [];
    const { ledger } = makeLedger([makeOrder()], { auto_fulfilment_enabled: true }, [STORE_LINE], [
      healthyLink({ syncState: "held_unavailable" }),
    ]);
    const summary = await processFulfilmentQueue(ledger, makeSupplier(calls));
    expect(calls).not.toContain("confirm");
    expect(summary.dispatched).toBe(0);
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

describe("supplier line linkage", () => {
  const storeLines = [
    { id: "l1", shopify_line_item_id: "9001", shopify_variant_id: "5001", shopify_product_id: "4001", sku: "NG-001", quantity: 2 },
  ];

  it("links an exact match", () => {
    const decision = lineLinkageDecision({
      storeLines: storeLines as never,
      supplierLines: [{ variantId: "5001", productId: "4001", sku: "NG-001", quantity: 2, raw: {} }] as never,
    });
    expect(decision.ok).toBe(true);
    expect(decision.mappings).toHaveLength(1);
  });

  it("holds an order when a store line has no supplier line", () => {
    const decision = lineLinkageDecision({
      storeLines: storeLines as never,
      supplierLines: [{ variantId: "9999", productId: "8888", sku: "OTHER", quantity: 2, raw: {} }] as never,
    });
    expect(decision.ok).toBe(false);
    expect(decision.state).toBe("manual_review");
  });

  it("holds an order when a store line matches more than one supplier line", () => {
    const decision = lineLinkageDecision({
      storeLines: storeLines as never,
      supplierLines: [
        { variantId: "5001", productId: null, sku: null, quantity: 2, raw: {} },
        { variantId: null, productId: "4001", sku: null, quantity: 2, raw: {} },
      ] as never,
    });
    expect(decision.ok).toBe(false);
    expect(decision.state).toBe("manual_review");
  });

  it("holds an order when quantities disagree", () => {
    const decision = lineLinkageDecision({
      storeLines: storeLines as never,
      supplierLines: [{ variantId: "5001", productId: "4001", sku: "NG-001", quantity: 1, raw: {} }] as never,
    });
    expect(decision.ok).toBe(false);
    expect(decision.state).toBe("manual_review");
  });

  it("holds an order when the supplier exposes no line detail", () => {
    const decision = lineLinkageDecision({ storeLines: storeLines as never, supplierLines: [] });
    expect(decision.ok).toBe(false);
  });

  it("links on the store line id the supplier echoes back", () => {
    const decision = lineLinkageDecision({
      storeLines: [
        {
          id: "line-1",
          shopify_line_item_id: "gid://shopify/LineItem/48159170036042",
          shopify_variant_id: "gid://shopify/ProductVariant/62961656004938",
          shopify_product_id: "gid://shopify/Product/15968036585802",
          sku: "Z5RFSCNXI",
          quantity: 1,
        },
      ],
      supplierLines: [
        {
          id: "78797688",
          storeLineItemId: "48159170036042",
          productId: null,
          variantId: null,
          sku: null,
          quantity: 1,
        },
      ],
    });
    expect(decision.ok).toBe(true);
    expect(decision.mappings[0]?.zendrop_line_item_id).toBe("78797688");
  });
});


describe("fulfilment quote validity", () => {
  const scope = previewScope({ storeId: 5, orderId: 77, useCredit: false });

  it("accepts a fresh quote in the same scope", () => {
    const result = previewValidity({
      previewAt: new Date(Date.now() - 60_000).toISOString(),
      previewScope: scope,
      requiredScope: scope,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a quote older than the supplier window", () => {
    const result = previewValidity({
      previewAt: new Date(Date.now() - PREVIEW_TTL_MS - 1_000).toISOString(),
      previewScope: scope,
      requiredScope: scope,
    });
    expect(result.valid).toBe(false);
  });

  it("rejects a quote taken under a different credit scope", () => {
    const result = previewValidity({
      previewAt: new Date().toISOString(),
      previewScope: previewScope({ storeId: 5, orderId: 77, useCredit: true }),
      requiredScope: scope,
    });
    expect(result.valid).toBe(false);
  });

  it("rejects a missing quote", () => {
    const result = previewValidity({ previewAt: null, previewScope: null, requiredScope: scope });
    expect(result.valid).toBe(false);
  });
});

describe("typed supplier line matching", () => {
  const line = (over: Record<string, unknown> = {}) => ({
    id: "l1",
    shopify_line_item_id: "9001",
    shopify_variant_id: "5001",
    shopify_product_id: "4001",
    sku: "NG-001",
    quantity: 2,
    ...over,
  });

  it("links on a SKU alone", () => {
    const decision = lineLinkageDecision({
      storeLines: [line({ shopify_variant_id: null, shopify_product_id: null })] as never,
      supplierLines: [{ id: "z1", variantId: null, productId: null, sku: "NG-001", quantity: 2 }] as never,
    });
    expect(decision.ok).toBe(true);
    expect(decision.mappings[0]!.zendrop_line_item_id).toBe("z1");
  });

  it("links on a variant id alone", () => {
    const decision = lineLinkageDecision({
      storeLines: [line({ sku: null, shopify_product_id: null })] as never,
      supplierLines: [{ id: "z1", variantId: "5001", productId: null, sku: null, quantity: 2 }] as never,
    });
    expect(decision.ok).toBe(true);
  });

  it("links on a product id alone", () => {
    const decision = lineLinkageDecision({
      storeLines: [line({ sku: null, shopify_variant_id: null })] as never,
      supplierLines: [{ id: "z1", variantId: null, productId: "4001", sku: null, quantity: 2 }] as never,
    });
    expect(decision.ok).toBe(true);
  });

  it("refuses a cross type numeric collision", () => {
    // The supplier product id happens to equal the store variant id. Different
    // identifier classes must never satisfy each other.
    const decision = lineLinkageDecision({
      storeLines: [line({ sku: null, shopify_product_id: null })] as never,
      supplierLines: [{ id: "z1", variantId: null, productId: "5001", sku: null, quantity: 2 }] as never,
    });
    expect(decision.ok).toBe(false);
    expect(decision.state).toBe("manual_review");
  });

  it("refuses identifiers that point at different supplier lines", () => {
    const decision = lineLinkageDecision({
      storeLines: [line()] as never,
      supplierLines: [
        { id: "z1", variantId: null, productId: null, sku: "NG-001", quantity: 2 },
        { id: "z2", variantId: "5001", productId: "4001", sku: null, quantity: 2 },
      ] as never,
    });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toContain("two different supplier lines");
  });

  it("refuses when two supplier lines share the same identifier", () => {
    const decision = lineLinkageDecision({
      storeLines: [line({ shopify_variant_id: null, shopify_product_id: null })] as never,
      supplierLines: [
        { id: "z1", variantId: null, productId: null, sku: "NG-001", quantity: 2 },
        { id: "z2", variantId: null, productId: null, sku: "NG-001", quantity: 2 },
      ] as never,
    });
    expect(decision.ok).toBe(false);
  });

  it("fails closed when the supplier states no quantity", () => {
    const decision = lineLinkageDecision({
      storeLines: [line()] as never,
      supplierLines: [{ id: "z1", variantId: "5001", productId: "4001", sku: "NG-001", quantity: null }] as never,
    });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toContain("quantity");
  });

  it("refuses an unexpected supplier sale line", () => {
    const decision = lineLinkageDecision({
      storeLines: [line()] as never,
      supplierLines: [
        { id: "z1", variantId: "5001", productId: "4001", sku: "NG-001", quantity: 2 },
        { id: "z2", variantId: "7777", productId: "6666", sku: "EXTRA", quantity: 1 },
      ] as never,
    });
    expect(decision.ok).toBe(false);
    expect(decision.state).toBe("manual_review");
  });

  it("refuses two store lines that resolve to one supplier line", () => {
    const decision = lineLinkageDecision({
      storeLines: [
        line({ id: "l1", shopify_line_item_id: "9001" }),
        line({ id: "l2", shopify_line_item_id: "9002" }),
      ] as never,
      supplierLines: [{ id: "z1", variantId: "5001", productId: "4001", sku: "NG-001", quantity: 2 }] as never,
    });
    expect(decision.ok).toBe(false);
  });
});

describe("webhook delivery claim", () => {
  function store(initial: DeliveryRow | null, options: { casWins?: boolean } = {}) {
    const calls: string[] = [];
    const impl: DeliveryStore = {
      async find() {
        calls.push("find");
        return initial;
      },
      async insert() {
        calls.push("insert");
        return { id: "d-new", status: "processing", attempts: 1, updated_at: new Date().toISOString() };
      },
      async compareAndSet() {
        calls.push("cas");
        return options.casWins !== false;
      },
    };
    return { impl, calls };
  }

  const input = { webhookId: "w1", topic: "orders/paid", shopifyOrderId: "55" };

  it("claims a delivery that has never been seen", async () => {
    const { impl, calls } = store(null);
    const claim = await claimDelivery(impl, input);
    expect(claim).toEqual({ claimed: true, deliveryId: "d-new", attempts: 1 });
    expect(calls).toContain("insert");
  });

  it("refuses a delivery that was already processed", async () => {
    const { impl } = store({ id: "d1", status: "processed", attempts: 1, updated_at: new Date().toISOString() });
    expect(await claimDelivery(impl, input)).toEqual({ claimed: false, reason: "already_processed" });
  });

  it("refuses a delivery that is still being processed", async () => {
    const { impl, calls } = store({ id: "d1", status: "processing", attempts: 1, updated_at: new Date().toISOString() });
    expect(await claimDelivery(impl, input)).toEqual({ claimed: false, reason: "in_flight" });
    expect(calls).not.toContain("cas");
  });

  it("retries a delivery that previously failed", async () => {
    const { impl } = store({ id: "d1", status: "failed", attempts: 2, updated_at: new Date().toISOString() });
    expect(await claimDelivery(impl, input)).toEqual({ claimed: true, deliveryId: "d1", attempts: 3 });
  });

  it("recovers a processing delivery once its lease has expired", async () => {
    const stale = new Date(Date.now() - DELIVERY_LEASE_MS - 1_000).toISOString();
    const { impl } = store({ id: "d1", status: "processing", attempts: 1, updated_at: stale });
    expect(await claimDelivery(impl, input)).toEqual({ claimed: true, deliveryId: "d1", attempts: 2 });
  });

  it("hands the claim to exactly one worker when two race", async () => {
    const stale = new Date(Date.now() - DELIVERY_LEASE_MS - 1_000).toISOString();
    const { impl } = store({ id: "d1", status: "failed", attempts: 1, updated_at: stale }, { casWins: false });
    expect(await claimDelivery(impl, input)).toEqual({ claimed: false, reason: "in_flight" });
  });
});

describe("uncertain supplier confirmation", () => {
  it("stops for reconciliation and cannot be retried as a fresh confirmation", async () => {
    const calls: string[] = [];
    const order = makeOrder({
      orchestration_state: "awaiting_fulfilment_confirmation",
      zendrop_order_id: 77,
      zendrop_store_id: 5,
      preview_at: new Date().toISOString(),
      preview_scope: previewScope({ storeId: 5, orderId: 77, useCredit: false }),
    });
    const { ledger } = makeLedger([order], { auto_fulfilment_enabled: true });
    const supplier: SupplierPort = {
      ...makeSupplier(calls),
      async confirmFulfilment() {
        calls.push("confirm");
        throw new Error("socket hang up");
      },
    };

    const first = await processFulfilmentQueue(ledger, supplier);
    expect(calls.filter((call) => call === "confirm")).toHaveLength(1);
    expect(first.dispatched).toBe(0);
    expect(order.orchestration_state).toBe("manual_review");
    expect(order.dispatch_idempotency_key).toBe(dispatchKey(order.shopify_order_id, 77));

    // A second pass must not send another confirmation for the same order.
    order.orchestration_state = "awaiting_fulfilment_confirmation";
    const second = await processFulfilmentQueue(ledger, supplier);
    expect(calls.filter((call) => call === "confirm")).toHaveLength(1);
    expect(second.dispatched).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it("allows a supplier added insert that claims no store line", () => {
    const decision = lineLinkageDecision({
      storeLines: [
        {
          id: "line-1",
          shopify_line_item_id: "48159403540810",
          shopify_variant_id: "62968616911178",
          shopify_product_id: "15969386922314",
          sku: "SKU-A",
          quantity: 1,
        },
      ],
      supplierLines: [
        { id: "1", storeLineItemId: "48159403540810", productId: null, variantId: null, sku: null, quantity: 1 },
        { id: "2", storeLineItemId: "TYC-76358978655", productId: null, variantId: null, sku: null, quantity: 1 },
      ],
    });
    expect(decision.ok).toBe(true);
    expect(decision.mappings).toHaveLength(1);
  });

  it("still refuses a supplier line that claims a store line the order does not contain", () => {
    const decision = lineLinkageDecision({
      storeLines: [
        {
          id: "line-1",
          shopify_line_item_id: "111",
          shopify_variant_id: "222",
          shopify_product_id: "333",
          sku: "SKU-A",
          quantity: 1,
        },
      ],
      supplierLines: [
        { id: "1", storeLineItemId: "111", productId: null, variantId: null, sku: null, quantity: 1 },
        { id: "2", storeLineItemId: "999", productId: null, variantId: null, sku: null, quantity: 1 },
      ],
    });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toContain("lines the store order does not");
  });
});
