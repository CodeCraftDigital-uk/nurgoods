/**
 * Order orchestration logic.
 *
 * Pure with respect to infrastructure: everything it needs arrives through the
 * ports, so the same code runs in production and under test.
 *
 * Two rules drive the whole flow. Nothing reaches the supplier without store
 * evidence of payment, and nothing is dispatched twice.
 */
import type { LedgerPort, StoreFulfilmentPort, SupplierPort } from "./ports";
import { supplierPreflightDecision } from "./preflight";
import {
  dispatchKey,
  lineLinkageDecision,
  linkageDecision,
  previewScope,
  previewValidity,
  supplierStatusToState,
  type OrchestrationState,
  type OrderRecord,
  type StoreLine,
} from "./types";


export interface QueueSummary {
  considered: number;
  linked: number;
  previewed: number;
  dispatched: number;
  skipped: number;
  failures: number;
  notes: string[];
}

export interface TrackingSummary {
  considered: number;
  updated: number;
  shipped: number;
  delivered: number;
  storeUpdated: number;
  failures: number;
  notes: string[];
}

async function move(
  ledger: LedgerPort,
  order: OrderRecord,
  to: OrchestrationState,
  code: string,
  message: string,
  patch: Record<string, unknown> = {},
): Promise<void> {
  await ledger.update(order.id, { orchestration_state: to, last_error: null, ...patch });
  await ledger.event({ orderId: order.id, from: order.orchestration_state, to, code, message });
  order.orchestration_state = to;
}

async function fail(
  ledger: LedgerPort,
  order: OrderRecord,
  to: OrchestrationState,
  code: string,
  message: string,
): Promise<void> {
  await ledger.update(order.id, {
    orchestration_state: to,
    last_error: message,
    retry_count: (order.retry_count ?? 0) + 1,
  });
  await ledger.event({ orderId: order.id, from: order.orchestration_state, to, code, message });
  order.orchestration_state = to;
}

/**
 * Moves paid orders through supplier linkage, the fulfilment quote and the
 * fulfilment confirmation.
 *
 * Automatic fulfilment is off unless it has been switched on, and an order is
 * only ever dispatched for real when it is either covered by that switch or
 * listed explicitly as safe for a real fulfilment test.
 */
export async function processFulfilmentQueue(
  ledger: LedgerPort,
  supplier: SupplierPort,
  options: { limit?: number } = {},
): Promise<QueueSummary> {
  const summary: QueueSummary = {
    considered: 0,
    linked: 0,
    previewed: 0,
    dispatched: 0,
    skipped: 0,
    failures: 0,
    notes: [],
  };

  const settings = await ledger.settings();
  const readiness = await supplier.available();
  if (!readiness.ready) {
    summary.notes.push(`The supplier account does not expose ${readiness.missing.join(", ")}`);
    return summary;
  }

  const storeId = await supplier.storeId();
  if (storeId === null) {
    summary.notes.push("No supplier store is connected, so no order can be matched");
    return summary;
  }

  const limit = Math.max(1, Math.min(options.limit ?? settings.max_orders_per_run, 25));
  const orders = await ledger.claim(
    ["awaiting_supplier_order", "awaiting_fulfilment_preview", "awaiting_fulfilment_confirmation"],
    limit,
  );
  summary.considered = orders.length;

  for (const order of orders) {
    try {
      // Linkage.
      if (order.zendrop_order_id === null) {
        const candidates = await supplier.listOrders({
          storeId,
          search: order.shopify_order_name ?? String(order.shopify_order_number ?? ""),
        });
        const decision = linkageDecision({
          candidates,
          storeOrderNumber: order.shopify_order_number,
          storeOrderName: order.shopify_order_name,
        });
        if (!decision.ok) {
          await move(ledger, order, decision.state, "linkage", decision.reason, {
            zendrop_store_id: storeId,
            ...(decision.supplierOrderId === null ? {} : { zendrop_order_id: decision.supplierOrderId }),
          });
          summary.skipped += 1;
          continue;
        }
        await move(ledger, order, "awaiting_fulfilment_preview", "linked", decision.reason, {
          zendrop_store_id: storeId,
          zendrop_order_id: decision.supplierOrderId,
        });
        order.zendrop_order_id = decision.supplierOrderId;
        order.zendrop_store_id = storeId;
        summary.linked += 1;
      }

      const supplierOrderId = order.zendrop_order_id!;
      const useCredit = settings.allow_supplier_credit;
      const scope = previewScope({ storeId, orderId: supplierOrderId, useCredit });

      // Line by line verification. The supplier order must correspond exactly
      // to the store order before any fulfilment step is taken.
      if (order.orchestration_state === "awaiting_fulfilment_preview") {
        const supplierOrder = await supplier.getOrder({ storeId, orderId: supplierOrderId });
        if (!supplierOrder) {
          await move(ledger, order, "manual_review", "linkage_lines", "The supplier order could not be read back");
          summary.skipped += 1;
          continue;
        }
        const storeLines = (await ledger.lines(order.id)) as unknown as StoreLine[];
        const lineDecision = lineLinkageDecision({
          storeLines,
          supplierLines: supplierOrder.lines ?? null,
        });
        if (!lineDecision.ok) {
          await move(ledger, order, lineDecision.state, "linkage_lines", lineDecision.reason);
          summary.skipped += 1;
          continue;
        }
        await ledger.linkLines(order.id, lineDecision.mappings);
        await ledger.update(order.id, { lines_linked_at: new Date().toISOString() });
      }

      // Step one of the supplier's two step fulfilment. Sent with confirmed
      // false, so nothing is committed and nothing is charged.
      if (order.orchestration_state === "awaiting_fulfilment_preview") {
        const preview = await supplier.previewFulfilment({ storeId, orderId: supplierOrderId, useCredit });
        const margin =
          order.order_total !== null && preview.totalCost !== null
            ? Number((order.order_total - preview.totalCost).toFixed(2))
            : null;
        await move(
          ledger,
          order,
          "awaiting_fulfilment_confirmation",
          "preview",
          "Fulfilment quoted by the supplier and held for confirmation",
          {
            product_cost: preview.productCost,
            shipping_cost: preview.shippingCost,
            fulfilment_cost: preview.totalCost,
            gross_margin: margin,
            preview_payload: preview.raw,
            preview_at: new Date().toISOString(),
            preview_is_credit_redeem: useCredit,
            preview_reference: preview.reference,
            preview_scope: scope,
          },
        );
        order.preview_at = new Date().toISOString();
        order.preview_scope = scope;
        order.preview_is_credit_redeem = useCredit;
        summary.previewed += 1;
      }

      // Step two. This is the only step that spends money, so it needs an
      // explicit authorisation, a current quote and a stable idempotency key.
      if (order.orchestration_state === "awaiting_fulfilment_confirmation") {
        const key = dispatchKey(order.shopify_order_id, supplierOrderId);
        if (order.dispatch_idempotency_key === key) {
          summary.skipped += 1;
          summary.notes.push(`${order.shopify_order_name ?? order.shopify_order_id} was already dispatched`);
          continue;
        }
        const authorised =
          settings.auto_fulfilment_enabled || settings.safe_test_order_ids.includes(order.shopify_order_id);
        if (!authorised) {
          summary.skipped += 1;
          await ledger.event({
            orderId: order.id,
            from: order.orchestration_state,
            to: order.orchestration_state,
            code: "awaiting_authorisation",
            message: "Quoted and ready. Automatic fulfilment is switched off, so it is waiting for approval.",
          });
          continue;
        }

        const validity = previewValidity({
          previewAt: order.preview_at,
          previewScope: order.preview_scope ?? null,
          requiredScope: scope,
        });
        if (!validity.valid) {
          // Back to step one rather than confirming against a stale quote.
          await move(ledger, order, "awaiting_fulfilment_preview", "preview_expired", validity.reason, {
            preview_at: null,
            preview_scope: null,
          });
          summary.skipped += 1;
          continue;
        }

        // Last mile supplier validation. The quote can be minutes old while
        // the underlying supplier facts are days old, so every mapped variant
        // is re-checked for mapping, freshness, stock and an evidenced landed
        // cost immediately before any money is committed.
        const storeLines = (await ledger.lines(order.id)) as unknown as StoreLine[];
        const productIds = [
          ...new Set(
            storeLines
              .map((storeLine) => storeLine.shopify_product_id)
              .filter((value): value is string => Boolean(value)),
          ),
        ];
        const links = await ledger.supplierHealth(productIds);
        const preflight = supplierPreflightDecision({
          lines: storeLines.map((storeLine) => ({
            shopifyVariantId: storeLine.shopify_variant_id ?? null,
            shopifyProductId: storeLine.shopify_product_id ?? null,
            quantity: Number(storeLine.quantity ?? 0),
            title: storeLine.sku ?? null,
          })),
          links,
        });
        if (!preflight.ok) {
          await fail(ledger, order, "manual_review", preflight.code, preflight.reason);
          summary.skipped += 1;
          continue;
        }

        // The key is written before the call, so a lost response can never be
        // replayed as a fresh confirmation.
        await ledger.update(order.id, { dispatch_idempotency_key: key });
        order.dispatch_idempotency_key = key;
        let operation;
        try {
          operation = await supplier.confirmFulfilment({
            storeId,
            orderId: supplierOrderId,
            useCredit,
            idempotencyKey: key,
          });
        } catch (cause) {
          // The confirmation may well have reached the supplier. Retrying it
          // could charge twice, so the order stops for a person to reconcile
          // it read only through the supplier order and operation lookups.
          const detail = cause instanceof Error ? cause.message : "The supplier call did not return";
          await fail(
            ledger,
            order,
            "manual_review",
            "dispatch_outcome_unknown",
            `The supplier confirmation outcome is unknown and must be reconciled before any retry. ${detail}`,
          );
          summary.failures += 1;
          continue;
        }

        if (!operation.succeeded && operation.terminal) {
          await fail(
            ledger,
            order,
            "fulfilment_failed",
            "dispatch_failed",
            operation.message ?? "The supplier refused the fulfilment",
          );
          summary.failures += 1;
          continue;
        }
        await move(ledger, order, "supplier_processing", "dispatched", "Sent to the supplier for fulfilment", {
          zendrop_fulfillment_operation_id: operation.id,
          supplier_status: operation.status,
          submitted_at: new Date().toISOString(),
        });
        summary.dispatched += 1;
      }

    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The fulfilment step failed";
      await fail(ledger, order, "fulfilment_failed", "exception", message);
      summary.failures += 1;
    }
  }

  return summary;
}

/**
 * Follows supplier progress and, once a shipment genuinely exists, records the
 * fulfilment in the store so the store sends its own customer notification.
 * No carrier name or tracking link is ever invented.
 */
export async function syncTracking(
  ledger: LedgerPort,
  supplier: SupplierPort,
  store: StoreFulfilmentPort,
  options: { limit?: number } = {},
): Promise<TrackingSummary> {
  const summary: TrackingSummary = {
    considered: 0,
    updated: 0,
    shipped: 0,
    delivered: 0,
    storeUpdated: 0,
    failures: 0,
    notes: [],
  };

  const readiness = await supplier.available();
  if (!readiness.ready) {
    summary.notes.push(`The supplier account does not expose ${readiness.missing.join(", ")}`);
    return summary;
  }
  const storeId = await supplier.storeId();
  if (storeId === null) {
    summary.notes.push("No supplier store is connected");
    return summary;
  }

  const orders = await ledger.claim(["supplier_processing", "shipped"], Math.max(1, options.limit ?? 10));
  summary.considered = orders.length;

  for (const order of orders) {
    try {
      if (order.zendrop_order_id === null) {
        await fail(ledger, order, "manual_review", "missing_link", "The supplier order reference was lost");
        summary.failures += 1;
        continue;
      }

      // A fulfilment operation still running is followed to its terminal state
      // before any tracking conclusion is drawn.
      if (order.zendrop_fulfillment_operation_id) {
        const operation = await supplier.getOperation({
          storeId,
          operationId: order.zendrop_fulfillment_operation_id,
        });
        if (operation.terminal && !operation.succeeded) {
          await fail(
            ledger,
            order,
            "fulfilment_failed",
            "operation_failed",
            operation.message ?? "The supplier fulfilment operation failed",
          );
          summary.failures += 1;
          continue;
        }
        if (operation.terminal) {
          await ledger.update(order.id, { zendrop_fulfillment_operation_id: null });
          order.zendrop_fulfillment_operation_id = null;
        }
      }

      const tracking = await supplier.getTracking({ storeId, orderId: order.zendrop_order_id });
      const mapped = supplierStatusToState(tracking.status);
      const patch: Record<string, unknown> = { supplier_status: tracking.status };
      if (tracking.trackingNumber) patch["tracking_number"] = tracking.trackingNumber;
      if (tracking.trackingUrl) patch["tracking_url"] = tracking.trackingUrl;
      if (tracking.carrier) patch["tracking_carrier"] = tracking.carrier;

      const hasShipment = Boolean(tracking.trackingNumber);
      const alreadyRecorded = Boolean(order.tracking_number);

      if (mapped === "delivered") {
        patch["delivered_at"] = new Date().toISOString();
      }
      if (mapped === "shipped" && order.orchestration_state !== "shipped") {
        patch["shipped_at"] = new Date().toISOString();
      }

      // Store fulfilment. Only once a real tracking number exists.
      if (hasShipment && !alreadyRecorded) {
        const fulfilmentOrders = await store.openFulfilmentOrders(order.shopify_order_id);
        if (fulfilmentOrders.length === 0) {
          summary.notes.push(
            `${order.shopify_order_name ?? order.shopify_order_id} has no open store fulfilment to update`,
          );
        } else {
          const created = await store.createFulfilment({
            fulfilmentOrderIds: fulfilmentOrders.map((item) => item.id),
            trackingNumber: tracking.trackingNumber,
            trackingUrl: tracking.trackingUrl,
            carrier: tracking.carrier,
            // Only notify when a genuine supplier shipment exists.
            notifyCustomer: Boolean(tracking.trackingNumber),

          });
          if (!created.ok) {
            await fail(ledger, order, "tracking_exception", "store_fulfilment_failed", created.message);
            summary.failures += 1;
            continue;
          }
          summary.storeUpdated += 1;
        }
      }

      const nextState: OrchestrationState =
        mapped === "delivered"
          ? "delivered"
          : mapped === "cancelled" || mapped === "supplier_rejected" || mapped === "out_of_stock"
            ? mapped
            : hasShipment
              ? "shipped"
              : order.orchestration_state;

      if (nextState !== order.orchestration_state) {
        await move(ledger, order, nextState, "tracking", `Supplier reports ${tracking.status ?? "an update"}`, patch);
        if (nextState === "shipped") summary.shipped += 1;
        if (nextState === "delivered") summary.delivered += 1;
      } else {
        await ledger.update(order.id, patch);
      }
      summary.updated += 1;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The tracking step failed";
      await fail(ledger, order, "tracking_exception", "exception", message);
      summary.failures += 1;
    }
  }

  return summary;
}
