/**
 * Ports used by the commerce orchestrator.
 *
 * The orchestrator only ever talks to these small interfaces, so its decision
 * logic can be exercised without touching the database, the supplier or the
 * store.
 */
import type { CommerceSettings, OrchestrationState, OrderLineRecord, OrderRecord } from "./types";

export interface LedgerPort {
  claim(states: OrchestrationState[], limit: number): Promise<OrderRecord[]>;
  lines(orderId: string): Promise<OrderLineRecord[]>;
  update(orderId: string, patch: Record<string, unknown>): Promise<void>;
  event(input: {
    orderId: string;
    from: OrchestrationState | null;
    to: OrchestrationState;
    code: string;
    message: string;
    detail?: Record<string, unknown>;
  }): Promise<void>;
  settings(): Promise<CommerceSettings>;
}

export interface SupplierOrderSummary {
  id: number;
  orderNumber: string | null;
  name: string | null;
  status: string | null;
  trackingNumber?: string | null;
  trackingUrl?: string | null;
  carrier?: string | null;
  lines?: Array<{ id: string | null; productId: string | null; variantId: string | null; sku: string | null }>;
}

export interface FulfilmentPreview {
  productCost: number | null;
  shippingCost: number | null;
  totalCost: number | null;
  currency: string | null;
  raw: Record<string, unknown>;
}

export interface FulfilmentOperation {
  id: string | null;
  status: string;
  terminal: boolean;
  succeeded: boolean;
  message: string | null;
}

export interface TrackingSnapshot {
  status: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  carrier: string | null;
  events: Array<{ at: string | null; description: string | null }>;
}

export interface SupplierPort {
  available(): Promise<{ ready: boolean; missing: string[] }>;
  storeId(): Promise<number | null>;
  listOrders(input: { storeId: number; search?: string | null }): Promise<SupplierOrderSummary[]>;
  getOrder(input: { storeId: number; orderId: number }): Promise<SupplierOrderSummary | null>;
  previewFulfilment(input: {
    storeId: number;
    orderId: number;
    useCredit: boolean;
  }): Promise<FulfilmentPreview>;
  confirmFulfilment(input: {
    storeId: number;
    orderId: number;
    useCredit: boolean;
    idempotencyKey: string;
  }): Promise<FulfilmentOperation>;
  getOperation(input: { storeId: number; operationId: string }): Promise<FulfilmentOperation>;
  getTracking(input: { storeId: number; orderId: number }): Promise<TrackingSnapshot>;
}

export interface StoreFulfilmentPort {
  /** Fulfilment orders that can still be actioned for this store order. */
  openFulfilmentOrders(shopifyOrderId: string): Promise<Array<{ id: string; status: string }>>;
  createFulfilment(input: {
    fulfilmentOrderIds: string[];
    trackingNumber: string | null;
    trackingUrl: string | null;
    carrier: string | null;
    notifyCustomer: boolean;
  }): Promise<{ ok: boolean; fulfilmentId: string | null; message: string }>;
}
