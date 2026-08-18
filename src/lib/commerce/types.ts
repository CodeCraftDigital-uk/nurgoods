/**
 * NUR GOODS commerce orchestration.
 *
 * The store remains the commerce system of record for payment, tax and the
 * customer relationship. The supplier remains the fulfilment layer. This
 * module is the ledger and the decision authority in between, so every order
 * has one place that records what was evidenced, what was sent to the supplier
 * and what came back.
 *
 * The whole module fails closed. Where evidence is missing or ambiguous the
 * order stops and waits for a person.
 */

export const ORCHESTRATION_STATES = [
  "payment_not_confirmed",
  "awaiting_supplier_order",
  "awaiting_fulfilment_preview",
  "awaiting_fulfilment_confirmation",
  "supplier_processing",
  "shipped",
  "delivered",
  "cancelled",
  "supplier_rejected",
  "out_of_stock",
  "fulfilment_failed",
  "tracking_exception",
  "manual_review",
] as const;

export type OrchestrationState = (typeof ORCHESTRATION_STATES)[number];

export const ORCHESTRATION_STATE_LABEL: Record<OrchestrationState, string> = {
  payment_not_confirmed: "Payment not confirmed",
  awaiting_supplier_order: "Waiting for the supplier order",
  awaiting_fulfilment_preview: "Waiting for a fulfilment quote",
  awaiting_fulfilment_confirmation: "Waiting for fulfilment confirmation",
  supplier_processing: "With the supplier",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
  supplier_rejected: "Refused by the supplier",
  out_of_stock: "Out of stock",
  fulfilment_failed: "Fulfilment failed",
  tracking_exception: "Tracking needs attention",
  manual_review: "Needs manual review",
};

/** States a person needs to look at. */
export const ATTENTION_STATES: OrchestrationState[] = [
  "supplier_rejected",
  "out_of_stock",
  "fulfilment_failed",
  "tracking_exception",
  "manual_review",
];

export const TERMINAL_STATES: OrchestrationState[] = ["delivered", "cancelled"];

/** States the fulfilment queue is allowed to pick up. */
export const FULFILMENT_QUEUE_STATES: OrchestrationState[] = [
  "awaiting_supplier_order",
  "awaiting_fulfilment_preview",
  "awaiting_fulfilment_confirmation",
];

/** States the tracking job follows. */
export const TRACKING_STATES: OrchestrationState[] = ["supplier_processing", "shipped"];

export interface CommerceSettings {
  auto_fulfilment_enabled: boolean;
  allow_supplier_credit: boolean;
  safe_test_order_ids: string[];
  max_orders_per_run: number;
}

export const DEFAULT_COMMERCE_SETTINGS: CommerceSettings = {
  auto_fulfilment_enabled: false,
  allow_supplier_credit: false,
  safe_test_order_ids: [],
  max_orders_per_run: 3,
};

export interface OrderRecord {
  id: string;
  shopify_order_id: string;
  shopify_order_name: string | null;
  shopify_order_number: number | null;
  shopify_financial_status: string | null;
  shopify_fulfillment_status: string | null;
  currency: string | null;
  order_total: number | null;
  zendrop_store_id: number | null;
  zendrop_order_id: number | null;
  zendrop_fulfillment_operation_id: string | null;
  orchestration_state: OrchestrationState;
  supplier_status: string | null;
  tracking_number: string | null;
  tracking_carrier: string | null;
  tracking_url: string | null;
  preview_at: string | null;
  preview_is_credit_redeem: boolean;
  dispatch_idempotency_key: string | null;
  retry_count: number;
  paid_at: string | null;
}

export interface OrderLineRecord {
  id: string;
  order_id: string;
  shopify_line_item_id: string;
  shopify_variant_id: string | null;
  shopify_product_id: string | null;
  sku: string | null;
  title: string | null;
  quantity: number;
  unit_price: number | null;
  zendrop_line_item_id: string | null;
  zendrop_product_id: string | null;
  zendrop_variant_id: string | null;
  supplier_status: string | null;
  tracking_number: string | null;
}

/**
 * Payment gate.
 *
 * Only a store order the store itself reports as paid may reach the supplier.
 * Nothing here infers payment from an amount, a customer note or the presence
 * of a fulfilment record.
 */
export function paymentEvidence(input: {
  financialStatus: string | null | undefined;
  cancelledAt?: string | null;
  fulfillmentStatus?: string | null;
  totalOutstanding?: number | null;
}): { paid: boolean; state: OrchestrationState; reason: string } {
  const status = (input.financialStatus ?? "").toLowerCase().replace(/\s+/g, "_");

  if (input.cancelledAt) {
    return { paid: false, state: "cancelled", reason: "The store order was cancelled" };
  }
  if (status === "refunded" || status === "voided") {
    return { paid: false, state: "cancelled", reason: `The store order is ${status}` };
  }
  if (status !== "paid") {
    return {
      paid: false,
      state: "payment_not_confirmed",
      reason: `The store reports payment as ${status || "unknown"}`,
    };
  }
  if (typeof input.totalOutstanding === "number" && input.totalOutstanding > 0) {
    return {
      paid: false,
      state: "payment_not_confirmed",
      reason: "The store order still has an outstanding balance",
    };
  }
  const fulfilment = (input.fulfillmentStatus ?? "").toLowerCase();
  if (fulfilment === "fulfilled") {
    return { paid: true, state: "shipped", reason: "The store order is already fulfilled" };
  }
  return { paid: true, state: "awaiting_supplier_order", reason: "Payment confirmed by the store" };
}

/**
 * Linkage check. A supplier order may only be fulfilled when it clearly
 * corresponds to this store order and is in a state that can still be acted
 * on.
 */
export function linkageDecision(input: {
  candidates: Array<{ id: number; orderNumber?: string | null; name?: string | null; status?: string | null }>;
  storeOrderNumber: number | null;
  storeOrderName: string | null;
}): { ok: boolean; supplierOrderId: number | null; state: OrchestrationState; reason: string } {
  const wantedNumber = input.storeOrderNumber === null ? null : String(input.storeOrderNumber);
  const wantedName = (input.storeOrderName ?? "").replace(/^#/, "").trim().toLowerCase();

  const matches = input.candidates.filter((candidate) => {
    const number = String(candidate.orderNumber ?? "").replace(/^#/, "").trim();
    const name = String(candidate.name ?? "").replace(/^#/, "").trim().toLowerCase();
    return (
      (wantedNumber !== null && number !== "" && number === wantedNumber) ||
      (wantedName !== "" && name !== "" && name === wantedName)
    );
  });

  if (matches.length === 0) {
    return {
      ok: false,
      supplierOrderId: null,
      state: "awaiting_supplier_order",
      reason: "No supplier order matches this store order yet",
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      supplierOrderId: null,
      state: "manual_review",
      reason: "More than one supplier order matches this store order",
    };
  }

  const match = matches[0]!;
  const status = String(match.status ?? "").toLowerCase();
  if (status.includes("cancel")) {
    return { ok: false, supplierOrderId: match.id, state: "cancelled", reason: "The supplier order is cancelled" };
  }
  if (status.includes("shipped") || status.includes("delivered") || status.includes("fulfilled")) {
    return {
      ok: false,
      supplierOrderId: match.id,
      state: "supplier_processing",
      reason: "The supplier order has already been fulfilled",
    };
  }
  return { ok: true, supplierOrderId: match.id, state: "awaiting_fulfilment_preview", reason: "Supplier order linked" };
}

/** Maps a supplier order status onto the NUR GOODS orchestration state. */
export function supplierStatusToState(status: string | null | undefined): OrchestrationState | null {
  const value = (status ?? "").toLowerCase();
  if (!value) return null;
  if (value.includes("cancel")) return "cancelled";
  if (value.includes("reject") || value.includes("declin")) return "supplier_rejected";
  if (value.includes("out of stock") || value.includes("out_of_stock") || value.includes("backorder")) {
    return "out_of_stock";
  }
  if (value.includes("deliver")) return "delivered";
  if (value.includes("ship") || value.includes("transit")) return "shipped";
  if (value.includes("process") || value.includes("unfulfilled") || value.includes("pending")) {
    return "supplier_processing";
  }
  return null;
}

/** Stable dispatch key so a repeated run can never place a second order. */
export function dispatchKey(shopifyOrderId: string, supplierOrderId: number | string): string {
  return `${shopifyOrderId}::${supplierOrderId}`;
}
