import type { SupabaseClient } from "@supabase/supabase-js";
import { detectProducts, processIntake } from "./intake.server";
import { materialIntakeFingerprint } from "./fingerprint";

/** Scheduled intake jobs: the delta sync fallback and the intake worker. */

type Db = SupabaseClient<any, "public", any>;

export interface IntakeJobSummary {
  message: string;
  details: Record<string, number | string>;
}

/**
 * Low frequency fallback. Asks the store only for products changed since the
 * last successful pass rather than pulling the whole catalogue.
 */
export async function runIntakeDeltaSync(db: Db, lookbackHours = 26): Promise<IntakeJobSummary> {
  const { data: job } = await db
    .from("automation_jobs")
    .select("last_run_at, config")
    .eq("job_key", "product_intake_delta_sync")
    .maybeSingle();

  const configured = Number((job as any)?.config?.lookback_hours);
  const hours = Number.isFinite(configured) && configured > 0 ? configured : lookbackHours;
  const lastRun = (job as any)?.last_run_at as string | null;
  const since = new Date(
    Math.min(
      lastRun ? new Date(lastRun).getTime() - 3600_000 : Date.now() - hours * 3600_000,
      Date.now() - 3600_000,
    ),
  ).toISOString();

  const { fetchShopifyProductsUpdatedSince, mirrorShopifyProducts } = await import(
    "@/lib/services/shopify.server"
  );

  const products = await fetchShopifyProductsUpdatedSince(since);
  if (products.length === 0) {
    return {
      message: "No products changed in the store since the last intake pass.",
      details: { since, changed: 0 },
    };
  }

  const idMap = await mirrorShopifyProducts(db, products, "Product intake delta sync");
  const detection = await detectProducts(
    db,
    products.map((product) => ({
      shopifyProductId: product.id,
      title: product.title ?? null,
      handle: product.handle ?? null,
      productId: idMap.get(product.id) ?? null,
      updatedAt: (product as any).updatedAt ?? null,
      source: "delta_sync" as const,
      // Only material catalogue content requeues a settled product. Inventory
      // and pricing movement is recorded without reprocessing.
      materialFingerprint: materialIntakeFingerprint(product as never),
    })),
  );

  return {
    message: `Checked ${products.length} changed products. ${detection.created} new and ${detection.requeued} materially changed entered intake. ${detection.unchanged} were price, stock or timestamp only.`,
    details: {
      since,
      changed: products.length,
      created: detection.created,
      requeued: detection.requeued,
      unchanged: detection.unchanged,
    },
  };
}

/** Drains the intake queue in bounded batches. */
export async function runIntakeWorker(db: Db, batchSize = 6): Promise<IntakeJobSummary> {
  const result = await processIntake(db, batchSize);
  if (result.processed === 0) {
    return { message: "Nothing was waiting in product intake.", details: {} };
  }
  return {
    message: `Processed ${result.processed} products. ${result.published} went live, ${result.quarantined} were quarantined and ${result.failed} failed.`,
    details: {
      processed: result.processed,
      approved: result.approved,
      published: result.published,
      quarantined: result.quarantined,
      failed: result.failed,
      classified: result.classified,
      optimised: result.optimised,
    },
  };
}
