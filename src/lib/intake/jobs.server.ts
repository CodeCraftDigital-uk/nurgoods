import type { SupabaseClient } from "@supabase/supabase-js";
import { detectProducts, processIntake, revalidateQuarantined } from "./intake.server";
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

/**
 * Webhook deliveries record the product without calling the store, so a newly
 * detected product can be waiting without a mirrored row. This pulls a small
 * bounded batch of those from the store before the queue is drained.
 */
async function mirrorPendingIntake(db: Db, limit: number): Promise<number> {
  const { data: rows } = await db
    .from("product_intake_records")
    .select("shopify_product_id")
    .is("product_id", null)
    .in("state", ["detected", "queued", "processing"])
    .order("detected_at", { ascending: true })
    .limit(limit);

  const ids = [...new Set(((rows ?? []) as any[]).map((row) => row.shopify_product_id as string))];
  if (ids.length === 0) return 0;

  const { fetchShopifyProductById, mirrorShopifyProducts } = await import(
    "@/lib/services/shopify.server"
  );

  let mirrored = 0;
  for (const id of ids) {
    try {
      const product = await fetchShopifyProductById(id);
      if (!product) continue;
      await mirrorShopifyProducts(db, [product], "Product intake catch up");
      mirrored += 1;
    } catch {
      // Left for the next pass. The delta sync also mirrors this product.
    }
  }
  return mirrored;
}

/** Drains the intake queue in bounded batches. */
export async function runIntakeWorker(db: Db, batchSize = 6): Promise<IntakeJobSummary> {
  const mirrored = await mirrorPendingIntake(db, batchSize);
  // Quarantines are re-examined first. Pricing integrity, the supplier
  // refresh and the catalogue mirror all correct data intake has already
  // judged, so a product held for a condition that has since been fixed is
  // put back through the normal pipeline rather than left hidden for good.
  const revalidated = await revalidateQuarantined(db, batchSize * 10);

  const result = await processIntake(db, batchSize);
  if (result.processed === 0 && revalidated.released === 0) {
    return {
      message: "Nothing was waiting in product intake.",
      details: { revalidated: revalidated.inspected, still_held: revalidated.stillHeld },
    };
  }
  return {
    message: `Processed ${result.processed} products. ${result.published} went live, ${result.quarantined} were quarantined and ${result.failed} failed. Revalidation released ${revalidated.released} of ${revalidated.inspected} held product(s).`,
    details: {
      processed: result.processed,
      approved: result.approved,
      published: result.published,
      quarantined: result.quarantined,
      failed: result.failed,
      classified: result.classified,
      optimised: result.optimised,
      revalidated: revalidated.inspected,
      released: revalidated.released,
      still_held: revalidated.stillHeld,
    },
  };
}

