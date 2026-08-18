/**
 * Supplier adapter for order fulfilment.
 *
 * Every call goes through a capability the supplier account genuinely exposes.
 * No operation name and no argument shape is invented.
 *
 * The supplier fulfilment is a two step call on the same action. Step one
 * sends confirmed false and returns the quote. Step two sends the identical
 * store, order and credit scope with confirmed true, within five minutes. The
 * separate cost lookup is supplemental and never replaces step one.
 */
import { callAction, loadCapabilityMap, unwrapContent } from "@/lib/zendrop/client.server";
import type { CapabilityRole } from "@/lib/zendrop/types";
import type {
  FulfilmentOperation,
  FulfilmentPreview,
  SupplierOrderSummary,
  SupplierPort,
  TrackingSnapshot,
} from "./ports";
import type { SupplierLine } from "./types";

const REQUIRED: CapabilityRole[] = ["stores_list", "orders_list", "order_get", "order_fulfil"];

function toNumber(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function firstList(payload: any): any[] {
  const source = unwrapContent(payload);
  if (Array.isArray(source)) return source;
  for (const key of ["orders", "data", "results", "items", "events", "tracking_events"]) {
    if (Array.isArray(source?.[key])) return source[key];
  }
  return [];
}

function text(value: unknown): string | null {
  return value === null || value === undefined || value === "" ? null : String(value);
}

/** Reads supplier line detail from the shapes the supplier actually returns. */
function supplierLines(raw: any): SupplierLine[] | undefined {
  const source =
    raw?.line_items ?? raw?.lineItems ?? raw?.items ?? raw?.order_items ?? raw?.order_line_items ?? null;
  if (!Array.isArray(source)) return undefined;
  return source.map((line: any) => ({
    id: text(line?.id ?? line?.line_item_id ?? line?.order_item_id),
    productId: text(line?.product_id ?? line?.productId ?? line?.product?.id),
    variantId: text(line?.variant_id ?? line?.variantId ?? line?.variant?.id),
    sku: text(line?.sku ?? line?.variant_sku ?? line?.variant?.sku),
    quantity: toNumber(line?.quantity ?? line?.qty),
  }));
}

function summarise(raw: any): SupplierOrderSummary {
  const lines = supplierLines(raw);
  const summary: SupplierOrderSummary = {
    id: Number(raw?.id ?? raw?.order_id),
    orderNumber:
      raw?.order_number != null
        ? String(raw.order_number)
        : raw?.external_order_number != null
          ? String(raw.external_order_number)
          : null,
    name: raw?.name != null ? String(raw.name) : raw?.order_name != null ? String(raw.order_name) : null,
    status: raw?.status != null ? String(raw.status) : raw?.fulfillment_status != null ? String(raw.fulfillment_status) : null,
    trackingNumber: text(raw?.tracking_number),
    trackingUrl: text(raw?.tracking_url),
    carrier: text(raw?.carrier ?? raw?.shipping_carrier),
  };
  if (lines) summary.lines = lines;
  return summary;
}

function operationOf(payload: any): FulfilmentOperation {
  const source = unwrapContent(payload) ?? {};
  const body = source?.operation ?? source?.data ?? source;
  const status = String(body?.status ?? body?.state ?? (body?.success === true ? "completed" : "pending")).toLowerCase();
  const failed = /fail|error|reject|cancel/.test(status);
  const done = /complete|success|fulfilled|shipped|done/.test(status);
  const message =
    body?.message != null
      ? String(body.message)
      : Array.isArray(body?.errors) && body.errors.length > 0
        ? body.errors.map((error: any) => String(error?.message ?? error)).join(" ")
        : null;
  return {
    id: body?.id != null ? String(body.id) : body?.operation_id != null ? String(body.operation_id) : null,
    status,
    terminal: failed || done,
    succeeded: done && !failed,
    message,
  };
}

/** Reads the cost fields out of a quote payload, whatever wrapper it arrives in. */
function costsOf(payload: any): FulfilmentPreview {
  const body = payload?.cost ?? payload?.costs ?? payload?.quote ?? payload?.data ?? payload ?? {};
  const product = toNumber(body?.product_cost ?? body?.products_cost ?? body?.subtotal);
  const shipping = toNumber(body?.shipping_cost ?? body?.shipping);
  const total = toNumber(body?.total_cost ?? body?.total) ?? ((product ?? 0) + (shipping ?? 0) || null);
  return {
    productCost: product,
    shippingCost: shipping,
    totalCost: total,
    currency: text(body?.currency),
    reference: text(body?.confirmation_token ?? body?.token ?? body?.reference ?? body?.quote_id ?? body?.id),
    raw: (body ?? {}) as Record<string, unknown>,
  };
}

export const zendropSupplierPort: SupplierPort = {
  async available() {
    const roles = await loadCapabilityMap();
    const missing = REQUIRED.filter((role) => !roles[role]).map(String);
    return { ready: missing.length === 0, missing };
  },

  async storeId() {
    const roles = await loadCapabilityMap();
    if (!roles.stores_list) return null;
    const stores = firstList(await callAction(roles.stores_list, {}));
    const first = stores[0];
    const id = toNumber(first?.id ?? first?.store_id);
    return id;
  },

  async listOrders({ storeId, search }) {
    const roles = await loadCapabilityMap();
    if (!roles.orders_list) return [];
    const args: Record<string, unknown> = { store_id: storeId };
    if (search) args["search"] = search;
    const rows = firstList(await callAction(roles.orders_list, args));
    return rows.map(summarise).filter((order) => Number.isFinite(order.id));
  },

  async getOrder({ storeId, orderId }) {
    const roles = await loadCapabilityMap();
    if (!roles.order_get) return null;
    const payload = unwrapContent(await callAction(roles.order_get, { store_id: storeId, order_id: orderId }));
    const body = payload?.order ?? payload?.data ?? payload;
    if (!body) return null;
    return summarise(body);
  },

  /**
   * Step one of the supplier's two step flow. The fulfilment action itself is
   * called with confirmed false. Nothing is committed and nothing is charged.
   */
  async previewFulfilment({ storeId, orderId, useCredit }) {
    const roles = await loadCapabilityMap();
    if (!roles.order_fulfil) throw new Error("The supplier account cannot fulfil orders");
    const payload = unwrapContent(
      await callAction(roles.order_fulfil, {
        store_id: storeId,
        order_id: orderId,
        is_credit_redeem: useCredit,
        confirmed: false,
      }),
    );
    const preview = costsOf(payload);

    // Supplemental read only lookup, used only to fill in a cost the quote did
    // not return. It can never stand in for step one.
    if (preview.totalCost === null && roles.order_fulfilment_cost) {
      const extra = costsOf(
        unwrapContent(
          await callAction(roles.order_fulfilment_cost, {
            store_id: storeId,
            order_id: orderId,
            is_credit_redeem: useCredit,
          }),
        ),
      );
      preview.productCost = preview.productCost ?? extra.productCost;
      preview.shippingCost = preview.shippingCost ?? extra.shippingCost;
      preview.totalCost = extra.totalCost;
      preview.currency = preview.currency ?? extra.currency;
      preview.raw = { ...preview.raw, supplemental_cost: extra.raw };
    }

    return preview;
  },

  async quoteFulfilmentCost({ storeId, orderId, useCredit }) {
    const roles = await loadCapabilityMap();
    if (!roles.order_fulfilment_cost) return null;
    return costsOf(
      unwrapContent(
        await callAction(roles.order_fulfilment_cost, {
          store_id: storeId,
          order_id: orderId,
          is_credit_redeem: useCredit,
        }),
      ),
    );
  },

  /** Step two. Identical scope to step one, sent with confirmed true. */
  async confirmFulfilment({ storeId, orderId, useCredit }) {
    const roles = await loadCapabilityMap();
    if (!roles.order_fulfil) throw new Error("The supplier account cannot fulfil orders");
    return operationOf(
      await callAction(roles.order_fulfil, {
        store_id: storeId,
        order_id: orderId,
        is_credit_redeem: useCredit,
        confirmed: true,
      }),
    );
  },


  async getOperation({ storeId, operationId }) {
    const roles = await loadCapabilityMap();
    if (!roles.order_fulfilment_operation) {
      return { id: operationId, status: "unknown", terminal: true, succeeded: true, message: null };
    }
    return operationOf(
      await callAction(roles.order_fulfilment_operation, { store_id: storeId, operation_id: operationId }),
    );
  },

  async getTracking({ storeId, orderId }) {
    const roles = await loadCapabilityMap();
    const snapshot: TrackingSnapshot = {
      status: null,
      trackingNumber: null,
      trackingUrl: null,
      carrier: null,
      events: [],
    };

    if (roles.order_get) {
      const order = await zendropSupplierPort.getOrder({ storeId, orderId });
      if (order) {
        snapshot.status = order.status ?? null;
        snapshot.trackingNumber = order.trackingNumber ?? null;
        snapshot.trackingUrl = order.trackingUrl ?? null;
        snapshot.carrier = order.carrier ?? null;
      }
    }

    if (roles.order_tracking) {
      const events = firstList(await callAction(roles.order_tracking, { store_id: storeId, order_id: orderId }));
      snapshot.events = events.map((event: any) => ({
        at: event?.created_at != null ? String(event.created_at) : event?.date != null ? String(event.date) : null,
        description:
          event?.description != null ? String(event.description) : event?.status != null ? String(event.status) : null,
      }));
      const latest = events[events.length - 1];
      if (!snapshot.trackingNumber && latest?.tracking_number) snapshot.trackingNumber = String(latest.tracking_number);
      if (!snapshot.trackingUrl && latest?.tracking_url) snapshot.trackingUrl = String(latest.tracking_url);
      if (!snapshot.carrier && latest?.carrier) snapshot.carrier = String(latest.carrier);
      if (!snapshot.status && latest?.status) snapshot.status = String(latest.status);
    }

    return snapshot;
  },
};
