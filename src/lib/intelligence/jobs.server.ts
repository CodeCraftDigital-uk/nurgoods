import type { SupabaseClient } from "@supabase/supabase-js";
import { assessQuality, findDuplicates } from "./core.server";
import { CLASSIFIER_VERSION, SEO_VERSION } from "./taxonomy";
import { enqueue, loadBundles, planWork, processQueue, type ProcessResult } from "./queue.server";

/**
 * Scheduled intelligence jobs.
 *
 * Backfill works the whole catalogue in controlled batches. Daily maintenance
 * requeues only what genuinely changed or went stale for a stated reason. The
 * weekly audit recalculates deterministic scores without regenerating wording.
 */

type Db = SupabaseClient<any, "public", any>;

const BACKFILL_PLAN_SIZE = 40;
const STALE_DAYS = 30;

export interface JobSummary {
  message: string;
  details: Record<string, number | string>;
}

/** Products the pipeline has never seen, oldest first. */
async function unseenProductIds(db: Db, limit: number): Promise<string[]> {
  const { data: all } = await db
    .from("shopify_products")
    .select("id, created_at")
    .order("created_at", { ascending: true })
    .limit(2000);
  const ids = ((all ?? []) as any[]).map((row) => row.id as string);
  if (ids.length === 0) return [];

  const { data: seen } = await db
    .from("product_classifications")
    .select("product_id")
    .in("product_id", ids);
  const known = new Set(((seen ?? []) as any[]).map((row) => row.product_id as string));
  return ids.filter((id) => !known.has(id)).slice(0, limit);
}

export async function backfillProgress(db: Db): Promise<{
  total: number;
  classified: number;
  optimised: number;
  queued: number;
  failed: number;
  percent: number;
}> {
  const [products, classified, optimised, queued, failed] = await Promise.all([
    db.from("shopify_products").select("id", { count: "exact", head: true }),
    db.from("product_classifications").select("id", { count: "exact", head: true }),
    db
      .from("product_seo_intelligence")
      .select("id", { count: "exact", head: true })
      .eq("auto_published", true),
    db.from("intelligence_queue").select("id", { count: "exact", head: true }).eq("status", "queued"),
    db.from("intelligence_queue").select("id", { count: "exact", head: true }).eq("status", "failed"),
  ]);

  const total = products.count ?? 0;
  const done = Math.min(classified.count ?? 0, total);
  return {
    total,
    classified: classified.count ?? 0,
    optimised: optimised.count ?? 0,
    queued: queued.count ?? 0,
    failed: failed.count ?? 0,
    percent: total === 0 ? 100 : Math.round((done / total) * 100),
  };
}

/** Batched backfill. Repeated calls move the catalogue forward safely. */
export async function runBackfill(db: Db, batchSize = 8): Promise<JobSummary> {
  const fresh = await unseenProductIds(db, BACKFILL_PLAN_SIZE);
  let planned = 0;
  if (fresh.length > 0) {
    const plan = await planWork(db, fresh, "Catalogue backfill");
    planned = plan.queued;
  }

  const processed = await processQueue(db, batchSize);
  const progress = await backfillProgress(db);

  return {
    message:
      progress.queued === 0 && fresh.length === 0
        ? `Backfill is complete. ${progress.classified} of ${progress.total} products carry a canonical category.`
        : `Processed ${processed.processed} items. ${progress.queued} remain in the queue.`,
    details: {
      planned,
      processed: processed.processed,
      classified: processed.classified,
      optimised: processed.optimised,
      corrections: processed.corrections,
      fallbacks: processed.fallbacks,
      failed: processed.failed,
      remaining: progress.queued,
      percent: progress.percent,
    },
  };
}

/**
 * Daily maintenance. Requeues stale or failed work and picks up genuine
 * content changes. Price and stock movements are handled without a model run
 * by the material change check inside planWork.
 */
export async function runDailyMaintenance(db: Db, batchSize = 12): Promise<JobSummary> {
  const reasons: string[] = [];
  let queued = 0;

  // Anything the pipeline has never touched.
  const fresh = await unseenProductIds(db, BACKFILL_PLAN_SIZE);
  if (fresh.length > 0) {
    queued += (await planWork(db, fresh, "New product detected")).queued;
    reasons.push(`${fresh.length} new products`);
  }

  // Recently changed mirrored records.
  const since = new Date(Date.now() - 3 * 24 * 3600_000).toISOString();
  const { data: recent } = await db
    .from("shopify_products")
    .select("id")
    .gte("last_synced_at", since)
    .limit(300);
  const recentIds = ((recent ?? []) as any[]).map((row) => row.id as string);
  if (recentIds.length > 0) {
    const plan = await planWork(db, recentIds, "Mirrored record changed");
    queued += plan.queued;
    if (plan.queued > 0) reasons.push(`${plan.classify + plan.seo} changed products`);
  }

  // Intelligence produced by an older engine version.
  const { data: outdatedClass } = await db
    .from("product_classifications")
    .select("product_id")
    .neq("classifier_version", CLASSIFIER_VERSION)
    .limit(100);
  const outdatedClassIds = ((outdatedClass ?? []) as any[]).map((row) => row.product_id as string);
  if (outdatedClassIds.length > 0) {
    queued += await enqueue(
      db,
      outdatedClassIds.map((id) => ({
        productId: id,
        stage: "classify" as const,
        reason: "Classifier version changed",
        priority: 130,
      })),
    );
    reasons.push(`${outdatedClassIds.length} on an older classifier`);
  }

  // Rejected, stale or version drifted search intelligence.
  const staleBefore = new Date(Date.now() - STALE_DAYS * 24 * 3600_000).toISOString();
  const { data: staleSeo } = await db
    .from("product_seo_intelligence")
    .select("product_id, validation_state, last_analysed_at, intelligence_version")
    .or(
      `validation_state.eq.rejected,intelligence_version.neq.${SEO_VERSION},last_analysed_at.lt.${staleBefore}`,
    )
    .limit(100);
  const staleIds = ((staleSeo ?? []) as any[]).map((row) => row.product_id as string);
  if (staleIds.length > 0) {
    queued += await enqueue(
      db,
      staleIds.map((id) => ({
        productId: id,
        stage: "seo" as const,
        reason: "Search intelligence is stale or was rejected",
        priority: 140,
      })),
    );
    reasons.push(`${staleIds.length} stale search records`);
  }

  // Retry bounded failures once a day.
  const { data: failedRows } = await db
    .from("intelligence_queue")
    .select("id")
    .eq("status", "failed")
    .lt("attempts", 6)
    .limit(50);
  const failedIds = ((failedRows ?? []) as any[]).map((row) => row.id as string);
  if (failedIds.length > 0) {
    await db
      .from("intelligence_queue")
      .update({ status: "queued", locked_at: null, lock_token: null } as never)
      .in("id", failedIds);
    reasons.push(`${failedIds.length} retried failures`);
  }

  const processed = await processQueue(db, batchSize);
  const progress = await backfillProgress(db);

  return {
    message:
      queued === 0 && processed.processed === 0
        ? "Nothing needed attention. All intelligence is current."
        : `Queued ${queued} items (${reasons.join(", ") || "no new reasons"}) and processed ${processed.processed}.`,
    details: {
      queued,
      processed: processed.processed,
      classified: processed.classified,
      optimised: processed.optimised,
      failed: processed.failed,
      remaining: progress.queued,
    },
  };
}

/**
 * Weekly audit. Deterministic only: quality scores, duplicate suspects,
 * broken internal links and taxonomy consistency. No wording is regenerated.
 */
export async function runQualityAudit(db: Db): Promise<JobSummary> {
  const { data: productRows } = await db
    .from("shopify_products")
    .select("id, title, handle")
    .limit(2000);
  const products = ((productRows ?? []) as any[]).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    handle: row.handle as string,
  }));
  if (products.length === 0) {
    return { message: "There is no synced catalogue to audit yet.", details: {} };
  }

  const bundles = await loadBundles(
    db,
    products.map((product) => product.id),
  );

  let scored = 0;
  for (const bundle of bundles) {
    const quality = assessQuality(bundle);
    const { error } = await db
      .from("product_classifications")
      .update({ quality_score: quality.score, quality_issues: quality.issues } as never)
      .eq("product_id", bundle.product.id);
    if (!error) scored += 1;
  }

  // Near duplicate suspects.
  const duplicates = findDuplicates(products);
  const duplicateMap = new Map(duplicates.map((item) => [item.id, item.duplicateOf]));
  await db
    .from("product_classifications")
    .update({ duplicate_of_product_id: null } as never)
    .not("duplicate_of_product_id", "is", null);
  for (const [id, duplicateOf] of duplicateMap) {
    await db
      .from("product_classifications")
      .update({ duplicate_of_product_id: duplicateOf } as never)
      .eq("product_id", id);
  }

  // Broken internal links inside stored search intelligence.
  const validHandles = new Set(products.map((product) => product.handle));
  const { data: collections } = await db.from("shopify_collections").select("handle").limit(1000);
  const validCollections = new Set(((collections ?? []) as any[]).map((row) => row.handle as string));
  const { data: seoRows } = await db
    .from("product_seo_intelligence")
    .select("id, internal_links")
    .limit(2000);

  let brokenLinks = 0;
  for (const row of ((seoRows ?? []) as any[])) {
    const links = Array.isArray(row.internal_links) ? row.internal_links : [];
    const kept = links.filter((link: any) => {
      if (link?.target_type === "product") return validHandles.has(link.target_reference);
      if (link?.target_type === "collection") return validCollections.has(link.target_reference);
      return false;
    });
    if (kept.length !== links.length) {
      brokenLinks += links.length - kept.length;
      await db.from("product_seo_intelligence").update({ internal_links: kept } as never).eq("id", row.id);
    }
  }

  // Taxonomy consistency: classifications pointing at a category that is gone
  // or has been disabled are requeued rather than left dangling.
  const { data: enabledCategories } = await db
    .from("catalogue_categories")
    .select("slug")
    .eq("enabled", true);
  const enabledSlugs = new Set(((enabledCategories ?? []) as any[]).map((row) => row.slug as string));
  const { data: classifications } = await db
    .from("product_classifications")
    .select("product_id, category_slug")
    .limit(2000);
  const drifted = ((classifications ?? []) as any[]).filter(
    (row) => !row.category_slug || !enabledSlugs.has(row.category_slug),
  );
  if (drifted.length > 0) {
    await enqueue(
      db,
      drifted.map((row) => ({
        productId: row.product_id as string,
        stage: "classify" as const,
        reason: "Category is no longer part of the live taxonomy",
        priority: 120,
      })),
    );
  }

  return {
    message: `Audited ${scored} products. Found ${duplicates.length} duplicate suspects, removed ${brokenLinks} broken links and requeued ${drifted.length} products for taxonomy drift.`,
    details: {
      audited: scored,
      duplicates: duplicates.length,
      broken_links: brokenLinks,
      taxonomy_drift: drifted.length,
    },
  };
}

export type { ProcessResult };

/**
 * Automatic worker. Drains the intelligence queue in bounded batches and seeds
 * the next slice of the catalogue when the queue empties, so the backfill
 * completes on its own without anyone pressing a control.
 */
export async function runIntelligenceWorker(db: Db, batchSize = 10): Promise<JobSummary> {
  const before = await backfillProgress(db);
  let planned = 0;
  if (before.queued < batchSize) {
    const fresh = await unseenProductIds(db, BACKFILL_PLAN_SIZE);
    if (fresh.length > 0) planned = (await planWork(db, fresh, "Catalogue backfill")).queued;
  }

  const processed = await processQueue(db, batchSize);
  const after = await backfillProgress(db);

  return {
    message:
      after.queued === 0 && planned === 0 && processed.processed === 0
        ? `Everything is current. ${after.classified} of ${after.total} products carry a canonical category.`
        : `Processed ${processed.processed} items. ${after.queued} remain queued.`,
    details: {
      planned,
      processed: processed.processed,
      classified: processed.classified,
      optimised: processed.optimised,
      failed: processed.failed,
      remaining: after.queued,
      percent: after.percent,
    },
  };
}

/**
 * Product identity pass. Deterministic evidence first, with canonical winner
 * election by lowest customer price among genuinely identical listings.
 */
export async function runIdentityJob(db: Db): Promise<JobSummary> {
  const { runDuplicateIdentity, reelectCanonicals } = await import("./dedupe.server");
  const identity = await runDuplicateIdentity(db);
  const elected = await reelectCanonicals(db);
  return {
    message: `${identity.highConfidenceGroups} verified groups, ${identity.suppressed} listings presented once, ${identity.suspectGroups} suspects for review.`,
    details: {
      inspected: identity.inspected,
      pairs: identity.pairs,
      groups: identity.groups,
      verified_groups: identity.highConfidenceGroups,
      suppressed: identity.suppressed,
      suspects: identity.suspectGroups,
      tie_breaks: identity.tieBreaksUsed,
      winner_changes: elected.changes,
    },
  };
}

/**
 * Recurring catalogue search intelligence sweep.
 *
 * Requeues only listings whose search intelligence is missing, rejected,
 * version drifted or stale, then processes a bounded slice. Wording is only
 * regenerated when the underlying product content genuinely changed, so the
 * sweep is idempotent and never rewrites settled metadata for its own sake.
 * No factual claim, specification or price is altered here.
 */
export async function runSeoSweep(db: Db, batchSize = 10): Promise<JobSummary> {
  const reasons: string[] = [];
  let queued = 0;

  // Listings that carry no search intelligence at all.
  const { data: allProducts } = await db.from("shopify_products").select("id").limit(2000);
  const productIds = ((allProducts ?? []) as any[]).map((row) => row.id as string);
  const { data: haveSeo } = await db
    .from("product_seo_intelligence")
    .select("product_id")
    .in("product_id", productIds.slice(0, 1000));
  const covered = new Set(((haveSeo ?? []) as any[]).map((row) => row.product_id as string));
  const missing = productIds.filter((id) => !covered.has(id)).slice(0, 50);
  if (missing.length > 0) {
    queued += await enqueue(
      db,
      missing.map((id) => ({
        productId: id,
        stage: "seo" as const,
        reason: "No search intelligence recorded",
        priority: 60,
      })),
    );
    reasons.push(`${missing.length} without search intelligence`);
  }

  // Rejected, version drifted or stale records.
  const staleBefore = new Date(Date.now() - STALE_DAYS * 24 * 3600_000).toISOString();
  const { data: stale } = await db
    .from("product_seo_intelligence")
    .select("product_id")
    .or(
      `validation_state.eq.rejected,intelligence_version.neq.${SEO_VERSION},last_analysed_at.lt.${staleBefore}`,
    )
    .limit(50);
  const staleIds = ((stale ?? []) as any[]).map((row) => row.product_id as string);
  if (staleIds.length > 0) {
    queued += await enqueue(
      db,
      staleIds.map((id) => ({
        productId: id,
        stage: "seo" as const,
        reason: "Search intelligence is stale, rejected or version drifted",
        priority: 140,
      })),
    );
    reasons.push(`${staleIds.length} stale or rejected`);
  }

  const processed = await processQueue(db, batchSize);
  const progress = await backfillProgress(db);

  return {
    message:
      queued === 0 && processed.processed === 0
        ? "Search intelligence is current across the catalogue."
        : `Queued ${queued} search items (${reasons.join(", ") || "no new reasons"}) and processed ${processed.processed}.`,
    details: {
      queued,
      processed: processed.processed,
      optimised: processed.optimised,
      failed: processed.failed,
      remaining: progress.queued,
      optimised_total: progress.optimised,
      total: progress.total,
    },
  };
}
