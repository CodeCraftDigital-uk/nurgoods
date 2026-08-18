/**
 * Supabase backed order ledger.
 *
 * Every state change is written with its reason so the order history is
 * reconstructable without reading supplier or store logs.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LedgerPort } from "./ports";
import {
  DEFAULT_COMMERCE_SETTINGS,
  type CommerceSettings,
  type OrchestrationState,
  type OrderLineRecord,
  type OrderRecord,
} from "./types";
import type { NormalisedOrder } from "./webhook";
import { paymentEvidence } from "./types";

type Db = SupabaseClient<any, "public", any>;

export function createLedger(db: Db): LedgerPort {
  return {
    async claim(states: OrchestrationState[], limit: number) {
      const { data } = await db
        .from("commerce_orders")
        .select("*")
        .in("orchestration_state", states)
        .order("paid_at", { ascending: true, nullsFirst: false })
        .limit(limit);
      return ((data ?? []) as any[]) as OrderRecord[];
    },
    async lines(orderId: string) {
      const { data } = await db.from("commerce_order_lines").select("*").eq("order_id", orderId);
      return ((data ?? []) as any[]) as OrderLineRecord[];
    },
    async update(orderId: string, patch: Record<string, unknown>) {
      await db.from("commerce_orders").update(patch as never).eq("id", orderId);
    },
    async event(input) {
      await db.from("commerce_order_events").insert({
        order_id: input.orderId,
        from_state: input.from,
        to_state: input.to,
        code: input.code,
        message: input.message,
        detail: (input.detail ?? {}) as never,
      } as never);
    },
    async settings() {
      return readCommerceSettings(db);
    },
  };
}

export async function readCommerceSettings(db: Db): Promise<CommerceSettings> {
  const { data } = await db.from("commerce_settings").select("*").eq("id", "default").maybeSingle();
  if (!data) return { ...DEFAULT_COMMERCE_SETTINGS };
  const row = data as any;
  return {
    auto_fulfilment_enabled: Boolean(row.auto_fulfilment_enabled),
    allow_supplier_credit: Boolean(row.allow_supplier_credit),
    safe_test_order_ids: Array.isArray(row.safe_test_order_ids) ? row.safe_test_order_ids.map(String) : [],
    max_orders_per_run: Number(row.max_orders_per_run) || DEFAULT_COMMERCE_SETTINGS.max_orders_per_run,
  };
}

/**
 * Records a store order and its lines. The orchestration state is derived from
 * the store's own payment evidence, never from the caller.
 */
export async function recordStoreOrder(
  db: Db,
  order: NormalisedOrder,
): Promise<{ orderId: string; state: OrchestrationState; created: boolean; reason: string }> {
  const evidence = paymentEvidence({
    financialStatus: order.financialStatus,
    cancelledAt: order.cancelledAt,
    fulfillmentStatus: order.fulfillmentStatus,
  });

  const { data: existing } = await db
    .from("commerce_orders")
    .select("id, orchestration_state, paid_at")
    .eq("shopify_order_id", order.shopifyOrderId)
    .maybeSingle();

  const base: Record<string, unknown> = {
    shopify_order_id: order.shopifyOrderId,
    shopify_order_name: order.shopifyOrderName,
    shopify_order_number: order.shopifyOrderNumber,
    shopify_financial_status: order.financialStatus,
    shopify_fulfillment_status: order.fulfillmentStatus,
    currency: order.currency,
    order_total: order.total,
    shipping_country: order.shippingCountry,
    shipping_city: order.shippingCity,
  };

  let orderId: string;
  let created = false;

  if (existing) {
    orderId = (existing as any).id;
    const settled = ["shipped", "delivered", "cancelled"].includes((existing as any).orchestration_state);
    const patch: Record<string, unknown> = { ...base };
    if (evidence.paid && (existing as any).paid_at === null) patch["paid_at"] = new Date().toISOString();
    // A later webhook must never drag a progressed order backwards.
    if (!settled && (existing as any).orchestration_state === "payment_not_confirmed" && evidence.paid) {
      patch["orchestration_state"] = "awaiting_supplier_order";
    }
    if (evidence.state === "cancelled") patch["orchestration_state"] = "cancelled";
    await db.from("commerce_orders").update(patch as never).eq("id", orderId);
  } else {
    const { data: inserted, error } = await db
      .from("commerce_orders")
      .insert({
        ...base,
        orchestration_state: evidence.state,
        paid_at: evidence.paid ? new Date().toISOString() : null,
      } as never)
      .select("id")
      .maybeSingle();
    if (error || !inserted) throw new Error(error?.message ?? "The order could not be recorded");
    orderId = (inserted as any).id;
    created = true;
  }

  for (const line of order.lines) {
    if (!line.shopifyLineItemId) continue;
    await db
      .from("commerce_order_lines")
      .upsert(
        {
          order_id: orderId,
          shopify_line_item_id: line.shopifyLineItemId,
          shopify_variant_id: line.shopifyVariantId,
          shopify_product_id: line.shopifyProductId,
          sku: line.sku,
          title: line.title,
          quantity: line.quantity,
          unit_price: line.unitPrice,
        } as never,
        { onConflict: "order_id,shopify_line_item_id" },
      );
  }

  await db.from("commerce_order_events").insert({
    order_id: orderId,
    from_state: null,
    to_state: evidence.state,
    code: created ? "recorded" : "updated",
    message: evidence.reason,
    detail: {} as never,
  } as never);

  return { orderId, state: evidence.state, created, reason: evidence.reason };
}

/** Idempotency for webhook deliveries. Returns true when this is a new event. */
export async function claimWebhookDelivery(
  db: Db,
  input: { eventId: string; topic: string; shopifyOrderId: string | null },
): Promise<boolean> {
  const { error } = await db.from("commerce_webhook_deliveries").insert({
    event_id: input.eventId,
    topic: input.topic,
    shopify_order_id: input.shopifyOrderId,
  } as never);
  return !error;
}
