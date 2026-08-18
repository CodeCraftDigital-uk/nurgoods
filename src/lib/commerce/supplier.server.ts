/**
 * Supplier adapter for order fulfilment.
 *
 * Every call goes through a capability the supplier account genuinely exposes.
 * No operation name and no argument shape is invented, and the confirmation
 * step is always separate from the quote.
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

const REQUIRED: CapabilityRole[] = ["stores_list", "orders_list", "order_fulfilment_cost", "order_fulfil"];

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

function summarise(raw: any): SupplierOrderSummary {
  return {
    id: Number(raw?.id ?? raw?.order_id),
    orderNumber:
      raw?.order_number != null
        ? String(raw.order_number)
        : raw?.external_order_number != null
          ? String(raw.external_order_number)
          : null,
    name: raw?.name != null ? String(raw.name) : raw?.order_name != null ? String(raw.order_name) : null,
    status: raw?.status != null ? String(raw.status) : raw?.fulfillment_status != null ? String(raw.fulfillment_status) : null,
    trackingNumber: raw?.tracking_number != null ? String(raw.tracking_number) : null,
    trackingUrl: raw?.tracking_url != null ? String(raw.tracking_url) : null,
    carrier: raw?.carrier != null ? String(raw.carrier) : raw?.shipping_carrier != null ? String(raw.shipping_carrier) : null,
  };
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

  async previewFulfilment({ storeId, orderId, useCredit }) {
    const roles = await loadCapabilityMap();
    if (!roles.order_fulfilment_cost) throw new Error("The supplier account cannot quote a fulfilment cost");
    const payload = unwrapContent(
      await callAction(roles.order_fulfilment_cost, {
        store_id: storeId,
        order_id: orderId,
        is_credit_redeem: useCredit,
      }),
    );
    const body = payload?.cost ?? payload?.data ?? payload ?? {};
    const product = toNumber(body?.product_cost ?? body?.products_cost ?? body?.subtotal);
    const shipping = toNumber(body?.shipping_cost ?? body?.shipping);
    const total = toNumber(body?.total_cost ?? body?.total) ?? ((product ?? 0) + (shipping ?? 0) || null);
    const preview: FulfilmentPreview = {
      productCost: product,
      shippingCost: shipping,
      totalCost: total,
      currency: body?.currency != null ? String(body.currency) : null,
      raw: (body ?? {}) as Record<string, unknown>,
    };
    return preview;
  },

  async confirmFulfilment({ storeId, orderId, useCredit }) {
    const roles = await loadCapabilityMap();
    if (!roles.order_fulfil) throw new Error("The supplier account cannot fulfil orders");
    // The supplier treats confirmed as the second step of a two step flow.
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
