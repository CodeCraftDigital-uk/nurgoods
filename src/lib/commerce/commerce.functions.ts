/**
 * Admin facing read and control surface for the order ledger.
 *
 * Every function verifies the caller is a signed in admin. Reads come straight
 * from the ledger. The only writes are operator decisions that carry no
 * supplier side effect, and every one of them records an event.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { CommerceSettings } from "./types";

async function assertAdmin(context: { supabase: any; userId: string }): Promise<void> {
  const { data: isAdmin } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!isAdmin) throw new Error("Forbidden");
}

export interface OrderSummary {
  id: string;
  shopify_order_id: string;
  shopify_order_name: string | null;
  shopify_order_number: number | null;
  shopify_financial_status: string | null;
  shopify_fulfillment_status: string | null;
  currency: string | null;
  order_total: number | null;
  shipping_city: string | null;
  shipping_country: string | null;
  line_count: number | null;
  orchestration_state: string;
  supplier_status: string | null;
  zendrop_order_id: number | null;
  zendrop_order_number: string | null;
  zendrop_store_id: number | null;
  tracking_number: string | null;
  tracking_carrier: string | null;
  tracking_url: string | null;
  dispatch_idempotency_key: string | null;
  retry_count: number | null;
  last_error: string | null;
  paid_at: string | null;
  submitted_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface JobHealth {
  job_key: string;
  label: string;
  enabled: boolean;
  schedule_cron: string | null;
  last_run_at: string | null;
  last_status: string | null;
}

export interface OrdersOverview {
  orders: OrderSummary[];
  settings: CommerceSettings;
  jobs: JobHealth[];
}

const ORDER_JOB_KEYS = ["order_fulfilment_queue", "order_tracking_sync"] as const;

export const listCommerceOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OrdersOverview> => {
    await assertAdmin(context);
    const db = context.supabase as any;

    const [orders, settings, jobs] = await Promise.all([
      db.from("commerce_orders").select("*").order("paid_at", { ascending: false, nullsFirst: false }).limit(500),
      db.from("commerce_settings").select("*").eq("id", "default").maybeSingle(),
      db.from("automation_jobs").select("*").in("job_key", ORDER_JOB_KEYS as unknown as string[]),
    ]);

    if (orders.error) throw new Error(orders.error.message);

    const settingsRow = settings.data as any;
    return {
      orders: (orders.data ?? []) as OrderSummary[],
      settings: {
        auto_fulfilment_enabled: Boolean(settingsRow?.auto_fulfilment_enabled),
        allow_supplier_credit: Boolean(settingsRow?.allow_supplier_credit),
        safe_test_order_ids: Array.isArray(settingsRow?.safe_test_order_ids)
          ? settingsRow.safe_test_order_ids.map(String)
          : [],
        max_orders_per_run: Number(settingsRow?.max_orders_per_run ?? 3),
      },
      jobs: ((jobs.data ?? []) as any[]).map((row) => ({
        job_key: row.job_key,
        label: row.label,
        enabled: Boolean(row.enabled),
        schedule_cron: row.schedule_cron ?? null,
        last_run_at: row.last_run_at ?? null,
        last_status: row.last_status ?? null,
      })),
    };
  });

export interface OrderLineView {
  id: string;
  shopify_line_item_id: string;
  shopify_variant_id: string | null;
  shopify_product_id: string | null;
  sku: string | null;
  title: string | null;
  quantity: number;
  unit_price: number | null;
  zendrop_line_item_id: string | null;
  zendrop_store_line_item_id: string | null;
  zendrop_product_id: string | null;
  zendrop_variant_id: string | null;
  supplier_status: string | null;
  tracking_number: string | null;
}

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export interface OrderEventView {
  id: string;
  from_state: string | null;
  to_state: string | null;
  code: string | null;
  message: string | null;
  detail: Json;
  created_at: string;
}

/** Ledger row as shown in the console, including the currency aware costs. */
export interface OrderFull extends OrderSummary {
  fulfilment_cost: number | null;
  product_cost: number | null;
  shipping_cost: number | null;
  gross_margin: number | null;
  zendrop_fulfillment_operation_id: string | null;
  preview_at: string | null;
  preview_reference: string | null;
  preview_scope: string | null;
  preview_is_credit_redeem: boolean | null;
  lines_linked_at: string | null;
  supplier_currency: string | null;
  supplier_product_cost: number | null;
  supplier_shipping_cost: number | null;
  supplier_fees: number | null;
  supplier_total: number | null;
  supplier_payment_amount: number | null;
  supplier_payment_currency: string | null;
  // Evidenced order economics. Anything not evidenced stays null.
  actual_gross_payment: number | null;
  actual_payment_fee: number | null;
  actual_payout: number | null;
  actual_supplier_cost_source: number | null;
  actual_supplier_cost_settlement: number | null;
  forecast_profit: number | null;
  forecast_margin: number | null;
  fulfilled_externally: boolean | null;
  economics_note: string | null;
}


export interface WebhookDeliveryView {
  id: string;
  webhook_id: string | null;
  topic: string | null;
  status: string | null;
  attempts: number | null;
  received_at: string | null;
  processed_at: string | null;
  last_error: string | null;
}

export interface OrderDetail {
  order: OrderFull | null;
  lines: OrderLineView[];
  events: OrderEventView[];
  deliveries: WebhookDeliveryView[];
  settings: CommerceSettings;
}

export const getCommerceOrder = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string }) => {
    if (!input?.orderId) throw new Error("An order is required");
    return input;
  })
  .handler(async ({ data, context }): Promise<OrderDetail> => {
    await assertAdmin(context);
    const db = context.supabase as any;

    const { data: order } = await db
      .from("commerce_orders")
      .select("*")
      .eq("id", data.orderId)
      .maybeSingle();

    if (!order) {
      return {
        order: null,
        lines: [],
        events: [],
        deliveries: [],
        settings: {
          auto_fulfilment_enabled: false,
          allow_supplier_credit: false,
          safe_test_order_ids: [],
          max_orders_per_run: 3,
        },
      };
    }

    const [lines, events, deliveries, settings] = await Promise.all([
      db.from("commerce_order_lines").select("*").eq("order_id", data.orderId).order("created_at"),
      db
        .from("commerce_order_events")
        .select("*")
        .eq("order_id", data.orderId)
        .order("created_at", { ascending: false }),
      db
        .from("commerce_webhook_deliveries")
        .select("*")
        .eq("shopify_order_id", (order as any).shopify_order_id)
        .order("received_at", { ascending: false }),
      db.from("commerce_settings").select("*").eq("id", "default").maybeSingle(),
    ]);

    const settingsRow = settings.data as any;
    return {
      order: order as OrderDetail["order"],
      lines: (lines.data ?? []) as OrderLineView[],
      events: (events.data ?? []) as OrderEventView[],
      deliveries: (deliveries.data ?? []) as WebhookDeliveryView[],
      settings: {
        auto_fulfilment_enabled: Boolean(settingsRow?.auto_fulfilment_enabled),
        allow_supplier_credit: Boolean(settingsRow?.allow_supplier_credit),
        safe_test_order_ids: Array.isArray(settingsRow?.safe_test_order_ids)
          ? settingsRow.safe_test_order_ids.map(String)
          : [],
        max_orders_per_run: Number(settingsRow?.max_orders_per_run ?? 3),
      },
    };
  });

/**
 * Operator decision on an order that needs a person. Neither branch talks to
 * the supplier: "resolved" parks the order, "requeue" hands it back to the
 * fulfilment queue only when no supplier order exists yet.
 */
export const setOrderReviewState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string; action: "resolve" | "requeue"; note?: string }) => {
    if (!input?.orderId) throw new Error("An order is required");
    if (input.action !== "resolve" && input.action !== "requeue") throw new Error("Unknown action");
    return input;
  })
  .handler(async ({ data, context }): Promise<{ state: string; message: string }> => {
    await assertAdmin(context);
    const db = context.supabase as any;

    const { data: order } = await db
      .from("commerce_orders")
      .select("*")
      .eq("id", data.orderId)
      .maybeSingle();
    if (!order) throw new Error("That order no longer exists");

    const current = (order as any).orchestration_state as string;
    let next = current;
    let message = "";

    if (data.action === "resolve") {
      next = (order as any).zendrop_order_id ? "supplier_processing" : "manual_review";
      if (next === current && next === "manual_review") {
        throw new Error("There is no supplier order to follow, so this cannot be marked resolved");
      }
      message = "Marked resolved by an admin. The order now follows the linked supplier order.";
    } else {
      if ((order as any).zendrop_order_id || (order as any).dispatch_idempotency_key) {
        throw new Error(
          "A supplier order is already linked, so this order cannot be returned to the fulfilment queue",
        );
      }
      next = "awaiting_supplier_order";
      message = "Returned to the fulfilment queue by an admin.";
    }

    await db
      .from("commerce_orders")
      .update({ orchestration_state: next, last_error: null })
      .eq("id", data.orderId);
    await db.from("commerce_order_events").insert({
      order_id: data.orderId,
      from_state: current,
      to_state: next,
      code: data.action === "resolve" ? "admin_resolved" : "admin_requeued",
      message: data.note?.trim() ? `${message} Note: ${data.note.trim()}` : message,
      detail: { actor: context.userId, source: "admin_console" },
    });

    return { state: next, message };
  });

/**
 * Records a supplier order that was placed outside the platform. This is a
 * linkage write only. Nothing is sent to the supplier and no dispatch key is
 * created that could later be mistaken for a platform dispatch.
 */
export const linkExternalSupplierOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      orderId: string;
      zendropStoreId: number;
      zendropOrderId: number;
      zendropOrderNumber?: string;
      supplierStatus?: string;
    }) => {
      if (!input?.orderId) throw new Error("An order is required");
      if (!Number.isFinite(input.zendropStoreId) || input.zendropStoreId <= 0) {
        throw new Error("A valid supplier store id is required");
      }
      if (!Number.isFinite(input.zendropOrderId) || input.zendropOrderId <= 0) {
        throw new Error("A valid supplier order id is required");
      }
      return input;
    },
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    await assertAdmin(context);
    const db = context.supabase as any;

    const { data: order } = await db
      .from("commerce_orders")
      .select("*")
      .eq("id", data.orderId)
      .maybeSingle();
    if (!order) throw new Error("That order no longer exists");
    if ((order as any).zendrop_order_id) {
      throw new Error("A supplier order is already linked to this order");
    }

    const { dispatchKey } = await import("./types");
    await db
      .from("commerce_orders")
      .update({
        zendrop_store_id: data.zendropStoreId,
        zendrop_order_id: data.zendropOrderId,
        zendrop_order_number: data.zendropOrderNumber?.trim() || null,
        supplier_status: data.supplierStatus?.trim() || "Processing",
        submitted_at: (order as any).submitted_at ?? new Date().toISOString(),
        dispatch_idempotency_key:
          (order as any).dispatch_idempotency_key ??
          dispatchKey((order as any).shopify_order_id, data.zendropOrderId),
        orchestration_state: "supplier_processing",
        last_error: null,
      })
      .eq("id", data.orderId);

    await db.from("commerce_order_events").insert({
      order_id: data.orderId,
      from_state: (order as any).orchestration_state,
      to_state: "supplier_processing",
      code: "admin_external_link",
      message:
        "An externally placed supplier order was linked by an admin. No supplier request was made by the platform.",
      detail: {
        actor: context.userId,
        zendrop_store_id: data.zendropStoreId,
        zendrop_order_id: data.zendropOrderId,
        source: "admin_console",
      },
    });

    return { ok: true };
  });

export interface SupplierSnapshot {
  available: boolean;
  missing: string[];
  status: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  carrier: string | null;
  events: Array<{ at: string | null; description: string | null }>;
  message: string;
}

/**
 * Read only supplier look up. Calls the supplier's order and tracking reads
 * and returns what came back. Nothing is written, quoted, reserved or
 * confirmed.
 */
export const readSupplierSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string }) => {
    if (!input?.orderId) throw new Error("An order is required");
    return input;
  })
  .handler(async ({ data, context }): Promise<SupplierSnapshot> => {
    await assertAdmin(context);
    const db = context.supabase as any;

    const { data: order } = await db
      .from("commerce_orders")
      .select("zendrop_store_id, zendrop_order_id")
      .eq("id", data.orderId)
      .maybeSingle();

    const storeId = (order as any)?.zendrop_store_id as number | null;
    const supplierOrderId = (order as any)?.zendrop_order_id as number | null;
    const empty = {
      status: null,
      trackingNumber: null,
      trackingUrl: null,
      carrier: null,
      events: [],
    };

    if (!storeId || !supplierOrderId) {
      return { available: false, missing: [], ...empty, message: "No supplier order is linked yet." };
    }

    const { zendropSupplierPort } = await import("./supplier.server");
    const readiness = await zendropSupplierPort.available();
    if (!readiness.ready) {
      return {
        available: false,
        missing: readiness.missing,
        ...empty,
        message: "The supplier connection is not configured.",
      };
    }

    const [summary, tracking] = await Promise.all([
      zendropSupplierPort.getOrder({ storeId, orderId: supplierOrderId }),
      zendropSupplierPort.getTracking({ storeId, orderId: supplierOrderId }),
    ]);

    return {
      available: true,
      missing: [],
      status: tracking.status ?? summary?.status ?? null,
      trackingNumber: tracking.trackingNumber,
      trackingUrl: tracking.trackingUrl,
      carrier: tracking.carrier,
      events: tracking.events,
      message: "Read only supplier snapshot. Nothing was changed at the supplier.",
    };
  });

/** Runs one of the two order jobs on demand through the existing job runner. */
export const runCommerceJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { jobKey: string }) => {
    if (!(ORDER_JOB_KEYS as readonly string[]).includes(input?.jobKey)) {
      throw new Error("Only the order jobs can be run from here");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { runAutomationJob } = await import("@/lib/automation/runner.server");
    return runAutomationJob({ supabase: context.supabase, userId: context.userId }, data.jobKey);
  });
