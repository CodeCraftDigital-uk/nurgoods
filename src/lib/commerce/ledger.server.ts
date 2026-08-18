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
    async linkLines(orderId: string, mappings) {
      for (const mapping of mappings) {
        await db
          .from("commerce_order_lines")
          .update({
            zendrop_line_item_id: mapping.zendrop_line_item_id,
            zendrop_product_id: mapping.zendrop_product_id,
            zendrop_variant_id: mapping.zendrop_variant_id,
          } as never)
          .eq("id", mapping.lineId)
          .eq("order_id", orderId);
      }
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
    line_count: order.lines.length,
  };

  let orderId: string;
  let created = false;
  // The state actually held after this webhook. It is not assumed to be the
  // payment evidence state, because a progressed order keeps its own state.
  let recordedState: OrchestrationState = evidence.state;

  if (existing) {
    orderId = (existing as any).id;
    const current = (existing as any).orchestration_state as OrchestrationState;
    recordedState = current;
    const settled = ["shipped", "delivered", "cancelled"].includes(current);
    const patch: Record<string, unknown> = { ...base };
    if (evidence.paid && (existing as any).paid_at === null) patch["paid_at"] = new Date().toISOString();
    // A later webhook must never drag a progressed order backwards.
    if (!settled && current === "payment_not_confirmed" && evidence.paid) {
      patch["orchestration_state"] = "awaiting_supplier_order";
      recordedState = "awaiting_supplier_order";
    }
    if (evidence.state === "cancelled") {
      patch["orchestration_state"] = "cancelled";
      recordedState = "cancelled";
    }
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

  const message =
    recordedState === evidence.state
      ? evidence.reason
      : `${evidence.reason}. The order stays at ${recordedState} because it has already progressed.`;

  await db.from("commerce_order_events").insert({
    order_id: orderId,
    from_state: null,
    to_state: recordedState,
    code: created ? "recorded" : "updated",
    message,
    detail: { payment_evidence_state: evidence.state } as never,
  } as never);

  return { orderId, state: recordedState, created, reason: message };
}

/* --------------------------- webhook delivery log ------------------------- */

export type DeliveryClaim =
  | { claimed: true; deliveryId: string; attempts: number }
  | { claimed: false; reason: "already_processed" | "in_flight" };

/**
 * Claims a webhook delivery for processing.
 *
 * A delivery is only refused when it has genuinely already been processed. A
 * delivery that was recorded but never completed is handed back so the store
 * can safely redeliver it.
 */
export async function claimWebhookDelivery(
  db: Db,
  input: { webhookId: string; topic: string; shopifyOrderId: string | null },
): Promise<DeliveryClaim> {
  const { data: existing } = await db
    .from("commerce_webhook_deliveries")
    .select("id, status, attempts")
    .eq("webhook_id", input.webhookId)
    .maybeSingle();

  if (existing) {
    const row = existing as any;
    if (row.status === "processed") return { claimed: false, reason: "already_processed" };
    const attempts = Number(row.attempts ?? 0) + 1;
    await db
      .from("commerce_webhook_deliveries")
      .update({ status: "processing", attempts, last_error: null } as never)
      .eq("id", row.id);
    return { claimed: true, deliveryId: String(row.id), attempts };
  }

  const { data: inserted, error } = await db
    .from("commerce_webhook_deliveries")
    .insert({
      webhook_id: input.webhookId,
      topic: input.topic,
      shopify_order_id: input.shopifyOrderId,
      status: "processing",
      attempts: 1,
    } as never)
    .select("id")
    .maybeSingle();

  if (error || !inserted) {
    // A concurrent delivery of the same event won the unique constraint.
    return { claimed: false, reason: "in_flight" };
  }
  return { claimed: true, deliveryId: String((inserted as any).id), attempts: 1 };
}

export async function completeWebhookDelivery(db: Db, deliveryId: string): Promise<void> {
  await db
    .from("commerce_webhook_deliveries")
    .update({ status: "processed", processed_at: new Date().toISOString(), last_error: null } as never)
    .eq("id", deliveryId);
}

export async function failWebhookDelivery(db: Db, deliveryId: string, message: string): Promise<void> {
  await db
    .from("commerce_webhook_deliveries")
    .update({ status: "failed", last_error: message.slice(0, 500) } as never)
    .eq("id", deliveryId);
}
