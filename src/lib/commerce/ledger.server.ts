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
    async supplierHealth(shopifyProductIds: string[]) {
      if (shopifyProductIds.length === 0) return [];
      const { data } = await db
        .from("product_supplier_links")
        .select(
          "shopify_product_id, sync_state, last_supplier_sync_at, manual_hold, landed_cost, variant_map, variant_stock",
        )
        .in("shopify_product_id", shopifyProductIds);
      return ((data ?? []) as any[]).map((row) => ({
        shopifyProductId: row.shopify_product_id ?? null,
        syncState: row.sync_state ?? null,
        lastSyncAt: row.last_supplier_sync_at ?? null,
        manualHold: row.manual_hold === true,
        landedCost: row.landed_cost === null ? null : Number(row.landed_cost),
        variantMap: Array.isArray(row.variant_map) ? row.variant_map : [],
        blockedVariantSkus: Array.isArray(row.variant_stock?.blocked_skus)
          ? row.variant_stock.blocked_skus.map(String)
          : [],
      }));
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
 * How long a delivery may stay in processing before it is treated as
 * abandoned. Conservative on purpose: a delivery that is genuinely still
 * running must never be picked up a second time.
 */
export const DELIVERY_LEASE_MS = 2 * 60 * 1000;

export interface DeliveryRow {
  id: string;
  status: string;
  attempts: number;
  updated_at: string;
}

/**
 * Decides what may be done with an existing delivery row.
 *
 * A processed delivery is finished. A delivery that is still inside its
 * processing lease belongs to another worker. Anything else, including a
 * delivery whose lease has expired, may be reclaimed.
 */
export function deliveryClaimDecision(input: {
  row: DeliveryRow | null;
  now?: number;
  leaseMs?: number;
}): { action: "insert" | "reclaim" | "processed" | "in_flight" } {
  if (!input.row) return { action: "insert" };
  const status = String(input.row.status ?? "").toLowerCase();
  if (status === "processed") return { action: "processed" };
  if (status === "processing") {
    const startedAt = Date.parse(input.row.updated_at ?? "");
    const now = input.now ?? Date.now();
    const lease = input.leaseMs ?? DELIVERY_LEASE_MS;
    if (!Number.isFinite(startedAt) || now - startedAt < lease) return { action: "in_flight" };
    return { action: "reclaim" };
  }
  return { action: "reclaim" };
}

/**
 * The small amount of storage the claim needs. Keeping it behind a port lets
 * the concurrency rules be exercised exactly, including the losing side of a
 * race.
 */
export interface DeliveryStore {
  find(webhookId: string): Promise<DeliveryRow | null>;
  insert(input: { webhookId: string; topic: string; shopifyOrderId: string | null }): Promise<DeliveryRow | null>;
  /**
   * Conditional update. It must only succeed when the row still holds exactly
   * the status and updated_at that were observed, so precisely one caller wins.
   */
  compareAndSet(input: { id: string; status: string; updatedAt: string; attempts: number }): Promise<boolean>;
}

/**
 * Claims a webhook delivery for processing.
 *
 * The claim is a lease taken by compare and set against the row exactly as it
 * was read. Two concurrent deliveries of the same event can never both win,
 * and a delivery that failed or was abandoned can still be retried.
 */
export async function claimDelivery(
  store: DeliveryStore,
  input: { webhookId: string; topic: string; shopifyOrderId: string | null; now?: number; leaseMs?: number },
): Promise<DeliveryClaim> {
  const existing = await store.find(input.webhookId);
  const decision = deliveryClaimDecision({
    row: existing,
    ...(input.now === undefined ? {} : { now: input.now }),
    ...(input.leaseMs === undefined ? {} : { leaseMs: input.leaseMs }),
  });

  if (decision.action === "processed") return { claimed: false, reason: "already_processed" };
  if (decision.action === "in_flight") return { claimed: false, reason: "in_flight" };

  if (decision.action === "insert") {
    const inserted = await store.insert({
      webhookId: input.webhookId,
      topic: input.topic,
      shopifyOrderId: input.shopifyOrderId,
    });
    // A concurrent delivery of the same event won the unique constraint.
    if (!inserted) return { claimed: false, reason: "in_flight" };
    return { claimed: true, deliveryId: inserted.id, attempts: inserted.attempts };
  }

  const row = existing!;
  const attempts = Number(row.attempts ?? 0) + 1;
  const won = await store.compareAndSet({
    id: row.id,
    status: row.status,
    updatedAt: row.updated_at,
    attempts,
  });
  if (!won) return { claimed: false, reason: "in_flight" };
  return { claimed: true, deliveryId: row.id, attempts };
}

function deliveryStore(db: Db): DeliveryStore {
  return {
    async find(webhookId) {
      const { data } = await db
        .from("commerce_webhook_deliveries")
        .select("id, status, attempts, updated_at")
        .eq("webhook_id", webhookId)
        .maybeSingle();
      if (!data) return null;
      const row = data as any;
      return {
        id: String(row.id),
        status: String(row.status),
        attempts: Number(row.attempts ?? 0),
        updated_at: String(row.updated_at),
      };
    },
    async insert(input) {
      const { data, error } = await db
        .from("commerce_webhook_deliveries")
        .insert({
          webhook_id: input.webhookId,
          topic: input.topic,
          shopify_order_id: input.shopifyOrderId,
          status: "processing",
          attempts: 1,
        } as never)
        .select("id, status, attempts, updated_at")
        .maybeSingle();
      if (error || !data) return null;
      const row = data as any;
      return {
        id: String(row.id),
        status: String(row.status),
        attempts: Number(row.attempts ?? 1),
        updated_at: String(row.updated_at),
      };
    },
    async compareAndSet(input) {
      const { data } = await db
        .from("commerce_webhook_deliveries")
        .update({ status: "processing", attempts: input.attempts, last_error: null } as never)
        .eq("id", input.id)
        .eq("status", input.status)
        .eq("updated_at", input.updatedAt)
        .select("id");
      return Array.isArray(data) && data.length === 1;
    },
  };
}

export async function claimWebhookDelivery(
  db: Db,
  input: { webhookId: string; topic: string; shopifyOrderId: string | null },
): Promise<DeliveryClaim> {
  return claimDelivery(deliveryStore(db), input);
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
