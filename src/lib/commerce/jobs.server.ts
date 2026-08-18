/**
 * Scheduled entry points for the order flow.
 *
 * Both jobs are safe to run repeatedly. The fulfilment queue is idempotent on
 * the dispatch key and the tracking job only ever reports what the supplier
 * genuinely returned.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createLedger } from "./ledger.server";
import { processFulfilmentQueue, syncTracking } from "./orchestrator";
import { zendropSupplierPort } from "./supplier.server";
import { shopifyStorePort } from "./store.server";

type Db = SupabaseClient<any, "public", any>;

export interface CommerceJobResult {
  ok: boolean;
  message: string;
  detail: Record<string, unknown>;
}

export async function runOrderFulfilmentQueue(db: Db, limit?: number): Promise<CommerceJobResult> {
  const summary = await processFulfilmentQueue(createLedger(db), zendropSupplierPort, { limit: limit ?? undefined });
  const parts = [
    `${summary.considered} order(s) considered`,
    `${summary.linked} linked`,
    `${summary.previewed} quoted`,
    `${summary.dispatched} dispatched`,
  ];
  if (summary.failures > 0) parts.push(`${summary.failures} failed`);
  return {
    ok: summary.failures === 0,
    message: [parts.join(", "), ...summary.notes].join(". "),
    detail: summary as unknown as Record<string, unknown>,
  };
}

export async function runOrderTrackingSync(db: Db, limit?: number): Promise<CommerceJobResult> {
  const summary = await syncTracking(createLedger(db), zendropSupplierPort, shopifyStorePort, {
    limit: limit ?? undefined,
  });
  const parts = [
    `${summary.considered} order(s) checked`,
    `${summary.shipped} shipped`,
    `${summary.delivered} delivered`,
    `${summary.storeUpdated} store update(s)`,
  ];
  if (summary.failures > 0) parts.push(`${summary.failures} failed`);
  return {
    ok: summary.failures === 0,
    message: [parts.join(", "), ...summary.notes].join(". "),
    detail: summary as unknown as Record<string, unknown>,
  };
}
