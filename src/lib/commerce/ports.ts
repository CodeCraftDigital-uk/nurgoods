/**
 * Ports used by the commerce orchestrator.
 *
 * The orchestrator only ever talks to these small interfaces, so its decision
 * logic can be exercised without touching the database, the supplier or the
 * store.
 */
import type {
  CommerceSettings,
  LineMapping,
  OrchestrationState,
  OrderLineRecord,
  OrderRecord,
  SupplierLine,
} from "./types";

export interface LedgerPort {
  claim(states: OrchestrationState[], limit: number): Promise<OrderRecord[]>;
  lines(orderId: string): Promise<OrderLineRecord[]>;
  linkLines(orderId: string, mappings: LineMapping[]): Promise<void>;
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
  lines?: SupplierLine[];
}

export interface FulfilmentPreview {
  productCost: number | null;
  shippingCost: number | null;
  totalCost: number | null;
  currency: string | null;
  /** Any confirmation token or reference the supplier returned with the quote. */
  reference: string | null;
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
  /**
   * Step one of the supplier's two step fulfilment. The same fulfilment call
   * is made with confirmed false, which reserves and quotes the work without
   * committing it.
   */
  previewFulfilment(input: {
    storeId: number;
    orderId: number;
    useCredit: boolean;
  }): Promise<FulfilmentPreview>;
  /** Supplemental read only cost lookup. Never a substitute for step one. */
  quoteFulfilmentCost(input: {
    storeId: number;
    orderId: number;
    useCredit: boolean;
  }): Promise<FulfilmentPreview | null>;
  /** Step two. Identical scope to step one, sent with confirmed true. */
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
