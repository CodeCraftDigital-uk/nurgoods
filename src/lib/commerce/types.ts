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
  preview_reference?: string | null;
  preview_scope?: string | null;
  lines_linked_at?: string | null;
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
  const kind = classifySupplierStatus(match.status);
  if (kind === "cancelled") {
    return { ok: false, supplierOrderId: match.id, state: "cancelled", reason: "The supplier order is cancelled" };
  }
  if (kind === "rejected") {
    return {
      ok: false,
      supplierOrderId: match.id,
      state: "supplier_rejected",
      reason: "The supplier rejected this order",
    };
  }
  if (kind === "fulfilled" || kind === "shipped" || kind === "delivered") {
    return {
      ok: false,
      supplierOrderId: match.id,
      state: "supplier_processing",
      reason: "The supplier order has already been fulfilled",
    };
  }
  if (kind === "partially_fulfilled") {
    return {
      ok: false,
      supplierOrderId: match.id,
      state: "manual_review",
      reason: "The supplier order is only partly fulfilled and needs a person to check it",
    };
  }
  return { ok: true, supplierOrderId: match.id, state: "awaiting_fulfilment_preview", reason: "Supplier order linked" };
}

/* ---------------------------- supplier statuses --------------------------- */

/**
 * The set of supplier order states this system understands.
 *
 * Supplier status strings are free text, and several of them contain each
 * other as substrings: "Unfulfilled" contains "fulfilled", "Unshipped"
 * contains "shipped". Matching by substring therefore reads a brand new
 * order as an already shipped one and silently skips fulfilment, so every
 * status is classified word by word with negations handled first.
 */
export type SupplierStatusKind =
  | "unknown"
  | "pending"
  | "processing"
  | "partially_fulfilled"
  | "fulfilled"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "rejected"
  | "out_of_stock";

export function classifySupplierStatus(status: string | null | undefined): SupplierStatusKind {
  const words = String(status ?? "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
  if (words.length === 0) return "unknown";
  const has = (...candidates: string[]) => candidates.some((candidate) => words.includes(candidate));
  const phrase = words.join(" ");

  // Negations first. These are the states that look positive by substring but
  // mean the exact opposite.
  if (has("unfulfilled", "unshipped", "unpaid")) {
    return has("processing") ? "processing" : "pending";
  }
  if (/\bnot (yet )?(fulfilled|shipped|delivered)\b/.test(phrase)) return "pending";

  if (has("cancelled", "canceled", "cancel", "voided", "refunded")) return "cancelled";
  if (has("rejected", "declined", "failed", "error")) return "rejected";
  if (has("backorder", "backordered", "oos") || /\bout of stock\b/.test(phrase)) return "out_of_stock";
  if (has("partial", "partially")) return "partially_fulfilled";
  if (has("delivered", "delivery", "completed")) return "delivered";
  if (has("shipped", "shipping", "transit", "dispatched")) return "shipped";
  if (has("fulfilled")) return "fulfilled";
  if (has("processing", "process", "preparing", "packing", "confirmed")) return "processing";
  if (has("pending", "awaiting", "unpaid")) return "pending";
  return "unknown";
}

/** Maps a supplier order status onto the NUR GOODS orchestration state. */
export function supplierStatusToState(status: string | null | undefined): OrchestrationState | null {
  switch (classifySupplierStatus(status)) {
    case "cancelled":
      return "cancelled";
    case "rejected":
      return "supplier_rejected";
    case "out_of_stock":
      return "out_of_stock";
    case "delivered":
      return "delivered";
    case "shipped":
      return "shipped";
    case "fulfilled":
    case "partially_fulfilled":
    case "processing":
    case "pending":
      return "supplier_processing";
    default:
      return null;
  }
}


/** Stable dispatch key so a repeated run can never place a second order. */
export function dispatchKey(shopifyOrderId: string, supplierOrderId: number | string): string {
  return `${shopifyOrderId}::${supplierOrderId}`;
}

/* ------------------------- fulfilment quote validity ---------------------- */

/**
 * The supplier holds a fulfilment quote for five minutes. A confirmation is
 * only ever sent against a quote that is still inside that window and was
 * taken under exactly the same store, order and credit scope.
 */
export const PREVIEW_TTL_MS = 5 * 60 * 1000;

/** Describes the exact scope a quote was taken under. */
export function previewScope(input: { storeId: number; orderId: number; useCredit: boolean }): string {
  return `${input.storeId}:${input.orderId}:${input.useCredit ? "credit" : "cash"}`;
}

export function previewValidity(input: {
  previewAt: string | null;
  previewScope: string | null;
  requiredScope: string;
  now?: number;
}): { valid: boolean; reason: string } {
  if (!input.previewAt) {
    return { valid: false, reason: "There is no supplier quote to confirm" };
  }
  if (input.previewScope !== input.requiredScope) {
    return { valid: false, reason: "The supplier quote was taken under a different scope" };
  }
  const at = Date.parse(input.previewAt);
  if (!Number.isFinite(at)) {
    return { valid: false, reason: "The supplier quote timestamp could not be read" };
  }
  const age = (input.now ?? Date.now()) - at;
  if (age < 0 || age >= PREVIEW_TTL_MS) {
    return { valid: false, reason: "The supplier quote has expired" };
  }
  return { valid: true, reason: "The supplier quote is current" };
}

/* ---------------------------- line item linkage --------------------------- */

export interface SupplierLine {
  id: string | null;
  /** The store line the supplier itself says this line came from. */
  storeLineItemId: string | null;
  productId: string | null;
  variantId: string | null;
  sku: string | null;
  quantity: number | null;
}

export interface StoreLine {
  id: string;
  shopify_line_item_id: string;
  shopify_variant_id: string | null;
  shopify_product_id: string | null;
  sku: string | null;
  quantity: number;
}

export interface LineMapping {
  lineId: string;
  zendrop_line_item_id: string | null;
  zendrop_product_id: string | null;
  zendrop_variant_id: string | null;
}

function normaliseId(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (raw === "") return "";
  const tail = raw.split("/").pop() ?? raw;
  return tail.toLowerCase();
}

type IdentifierClass = "store line" | "sku" | "variant" | "product";

/** Identifier classes are never pooled, so a SKU can only ever match a SKU. */
const IDENTIFIER_ORDER: IdentifierClass[] = ["store line", "sku", "variant", "product"];

function storeKey(line: StoreLine, kind: IdentifierClass): string {
  if (kind === "store line") return normaliseId(line.shopify_line_item_id);
  if (kind === "sku") return (line.sku ?? "").trim().toLowerCase();
  if (kind === "variant") return normaliseId(line.shopify_variant_id);
  return normaliseId(line.shopify_product_id);
}

function supplierKey(line: SupplierLine, kind: IdentifierClass): string {
  if (kind === "store line") return normaliseId(line.storeLineItemId);
  if (kind === "sku") return (line.sku ?? "").trim().toLowerCase();
  if (kind === "variant") return normaliseId(line.variantId);
  return normaliseId(line.productId);
}

function describe(line: StoreLine): string {
  return line.sku ?? line.shopify_line_item_id;
}

/**
 * Compares the supplier order against the store order line by line.
 *
 * Nothing is guessed and nothing is pooled. Each identifier is only ever
 * compared against the same class of identifier, so a numeric product id can
 * never coincidentally satisfy a variant id. A store line must resolve to
 * exactly one supplier line, every identifier that resolves must agree on the
 * same supplier line, each supplier line may be consumed once, and the
 * supplier must state a quantity that equals the store quantity. Anything
 * else, including a supplier line the store order does not contain, stops the
 * order.
 */
export function lineLinkageDecision(input: {
  storeLines: StoreLine[];
  supplierLines: SupplierLine[] | null | undefined;
}): { ok: boolean; state: OrchestrationState; reason: string; mappings: LineMapping[] } {
  const storeLines = input.storeLines;
  const supplierLines = input.supplierLines ?? [];
  const stop = (reason: string) => ({ ok: false, state: "manual_review" as OrchestrationState, reason, mappings: [] });

  if (storeLines.length === 0) return stop("The store order has no recorded lines");
  if (supplierLines.length === 0) {
    return stop("The supplier order does not expose any line detail to compare");
  }

  const mappings: LineMapping[] = [];
  const used = new Set<number>();

  for (const line of storeLines) {
    let resolved: number | null = null;
    let resolvedBy: IdentifierClass | null = null;

    for (const kind of IDENTIFIER_ORDER) {
      const wanted = storeKey(line, kind);
      if (wanted === "") continue;
      const matched: number[] = [];
      supplierLines.forEach((supplierLine, index) => {
        if (supplierKey(supplierLine, kind) === wanted) matched.push(index);
      });
      if (matched.length === 0) continue;
      if (matched.length > 1) {
        return stop(`More than one supplier line matches the ${kind} on store line ${describe(line)}`);
      }
      const index = matched[0]!;
      if (resolved === null) {
        resolved = index;
        resolvedBy = kind;
      } else if (resolved !== index) {
        return stop(
          `Store line ${describe(line)} points at two different supplier lines: the ${resolvedBy} and the ${kind} disagree`,
        );
      }
    }

    if (resolved === null) return stop(`No supplier line matches store line ${describe(line)}`);
    if (used.has(resolved)) return stop("Two store lines resolve to the same supplier line");
    used.add(resolved);

    const supplierLine = supplierLines[resolved]!;
    const supplierQuantity = supplierLine.quantity;
    if (typeof supplierQuantity !== "number" || !Number.isFinite(supplierQuantity)) {
      return stop(`The supplier does not state a quantity for ${describe(line)}, so it cannot be verified`);
    }
    if (supplierQuantity !== line.quantity) {
      return stop(
        `Quantity disagrees on ${describe(line)}: the store says ${line.quantity} and the supplier says ${supplierQuantity}`,
      );
    }

    mappings.push({
      lineId: line.id,
      zendrop_line_item_id: supplierLine.id,
      zendrop_product_id: supplierLine.productId,
      zendrop_variant_id: supplierLine.variantId,
    });
  }

  // The supplier adds its own lines to an order, such as a packaging insert.
  // Those carry no catalogue identity and no store line reference of their own,
  // so they are allowed through. Any other leftover supplier line is a real
  // sale line the store order does not contain and still stops the order.
  const leftover = supplierLines.filter((_, index) => !used.has(index));
  const isSupplierInsert = (line: SupplierLine) =>
    !/^\d+$/.test(String(line.storeLineItemId ?? "").trim()) &&
    !line.productId &&
    !line.variantId &&
    !line.sku;
  if (leftover.some((line) => !isSupplierInsert(line))) {
    return stop("The supplier order contains lines the store order does not");
  }



  return { ok: true, state: "awaiting_fulfilment_preview", reason: "Every line matched the supplier order", mappings };
}


