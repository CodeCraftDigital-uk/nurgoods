import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Hourly supplier sourcing job.
 *
 * One controlled, sequential pass per hour:
 *   screen supplier catalogue -> validate and price candidates ->
 *   queue -> import in small serial chunks -> reconcile store linkage ->
 *   book search intelligence for anything genuinely new.
 *
 * Nothing here bypasses the existing sourcing controls. Screening, duplicate
 * prevention, UK delivery confirmation, landed cost availability, margin
 * validation and the suitability threshold all run exactly as they do for a
 * reviewed manual batch. A candidate that cannot be fully evidenced is held,
 * never partially published. Repeated abnormal failures trip a circuit
 * breaker that pauses the job rather than hammering the supplier.
 */

type Db = SupabaseClient<any, "public", any>;

/** Maximum successful new listings per hourly run. Not a quota to fill. */
export const HOURLY_TARGET = 25;

/** Serial import chunk so one run never fires many heavy jobs at once. */
const IMPORT_CHUNK = 5;

/** Consecutive failed runs that trip the breaker. */
const BREAKER_THRESHOLD = 3;

export interface SourcingRunSummary {
  message: string;
  details: Record<string, number | string>;
}

async function consecutiveFailures(db: Db, jobKey: string): Promise<number> {
  const { data } = await db
    .from("automation_runs")
    .select("status")
    .eq("job_key", jobKey)
    .order("started_at", { ascending: false })
    .limit(BREAKER_THRESHOLD);
  let count = 0;
  for (const row of ((data ?? []) as any[])) {
    if (row.status === "failed") count += 1;
    else break;
  }
  return count;
}

async function tripBreaker(db: Db, jobKey: string, reason: string): Promise<void> {
  await db
    .from("automation_jobs")
    .update({
      enabled: false,
      last_status: "failed",
      last_result: { message: `Paused automatically. ${reason}` },
    } as never)
    .eq("job_key", jobKey);
}

/**
 * Runs one hourly sourcing pass. Safe to call repeatedly: candidate selection
 * is keyed by a stable idempotency key, queueing respects the import cap and
 * the queue drain locks each row before any supplier write.
 */
export async function runHourlySourcing(db: Db, jobKey: string): Promise<SourcingRunSummary> {
  const failures = await consecutiveFailures(db, jobKey);
  if (failures >= BREAKER_THRESHOLD) {
    await tripBreaker(db, jobKey, `${failures} consecutive failed runs were recorded.`);
    return {
      message: "The circuit breaker paused sourcing after repeated failures. Review the run log before resuming.",
      details: { consecutive_failures: failures },
    };
  }

  const { getZendropStatus } = await import("./connection.server");
  const status = await getZendropStatus();
  if (!status.configured) {
    return { message: "The supplier account is not connected, so nothing was sourced.", details: {} };
  }
  if (!status.massImportUnlocked) {
    return {
      message: "Automated sourcing stays locked until the controlled one product test has passed.",
      details: {},
    };
  }

  const { loadSourcingRules, runSourcingScreen, selectCandidates, queueCandidates, runImportQueue, reconcileImportedCandidates } =
    await import("./import.server");
  const rules = await loadSourcingRules();
  if (!rules.enabled || !rules.continuous_sourcing) {
    return {
      message: "Continuous sourcing is switched off in the sourcing rules, so nothing was sourced.",
      details: {},
    };
  }

  const target = Math.max(1, Math.min(rules.batch_size || HOURLY_TARGET, HOURLY_TARGET));

  const screen = await runSourcingScreen({ target });
  const recommended = screen.products
    .filter((product) => (product.outcome === "recommended" || product.outcome === "accepted") && product.score >= rules.min_suitability_score)
    .sort((a, b) => b.score - a.score)
    .slice(0, target);

  if (recommended.length === 0) {
    return {
      message: `Screened ${screen.funnel.queried} supplier products and none met the sourcing controls this hour.`,
      details: {
        candidates_found: screen.funnel.queried,
        eligible: screen.funnel.eligible,
        restricted: screen.funnel.restricted,
        category_excluded: screen.funnel.categoryExcluded,
        quality_failed: screen.funnel.qualityFailed,
        uk_unsuitable: screen.funnel.ukUnsuitable,
        pricing_failed: screen.funnel.pricingFailed,
        duplicates: screen.funnel.duplicateExcluded,
        imported: 0,
      },
    };
  }

  const selection = await selectCandidates({
    productIds: recommended.map((product) => product.productId),
    userId: null as unknown as string,
  });

  const queued = await queueCandidates(selection.candidateIds);

  // Sequential drain in small chunks. Each chunk waits for the previous one,
  // so the supplier never sees a burst of concurrent heavy operations.
  let processed = 0;
  let imported = 0;
  let failed = 0;
  const messages: string[] = [];
  let remaining = queued;
  while (remaining > 0) {
    const outcome = await runImportQueue(Math.min(IMPORT_CHUNK, remaining));
    processed += outcome.processed;
    imported += outcome.imported;
    failed += outcome.failed;
    messages.push(...outcome.messages);
    if (outcome.processed === 0) break;
    remaining -= outcome.processed;
    if (outcome.processed > 0 && outcome.imported === 0 && outcome.failed >= outcome.processed) {
      // Everything in this chunk failed. Stop early rather than continuing to
      // push into a supplier that is clearly refusing work.
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  // The supplier pushes into the store asynchronously, so the catalogue mirror
  // is refreshed first. Without this, a freshly pushed product cannot be
  // matched and would sit in the store at the raw supplier price until the
  // next manual sync, which is exactly how unrounded prices reached shoppers.
  try {
    const { syncCatalogue } = await import("@/lib/services/shopify.server");
    await syncCatalogue(db as never);
  } catch {
    // A sync failure must not stop the rest of the pass; the next run retries.
  }
  const reconciled = await reconcileImportedCandidates();
  const linked = reconciled.matched;

  // Prohibited category safety net. If anything adult or sexual reached the
  // store through the supplier push, it is unpublished and quarantined in the
  // same pass rather than waiting for a person to notice it.
  let quarantined = 0;
  try {
    const { quarantineProhibitedCatalogue } = await import("@/lib/policy/quarantine.server");
    quarantined = (await quarantineProhibitedCatalogue()).quarantined;
  } catch {
    // Reported by the next run; never blocks the rest of the pass.
  }


  // Pricing integrity safety net. The supplier pushes products into the store
  // itself, at its own raw price, so a listing can be live and mispriced
  // before this pass ever sees it. Every active price is therefore checked
  // against the formula in the same pass: anything evidenced is corrected and
  // anything that cannot be evidenced is taken off sale rather than left at a
  // price nobody can justify.
  let repriced = 0;
  let heldForPricing = 0;
  let nonCharmAfter = -1;
  try {
    const { enforceLivePricingIntegrity } = await import("@/lib/pricing/integrity.server");
    const integrity = await enforceLivePricingIntegrity({ userId: null });
    repriced = integrity.variantsRepriced;
    heldForPricing = integrity.productsHeld;
    nonCharmAfter = integrity.nonCharmAfter;
  } catch {
    // Reported by the dedicated integrity job; never blocks the rest of the pass.
  }

  // Book search intelligence for the listings that reached the store mirror,
  // so a new listing is optimised as part of the same pipeline.
  let seoQueued = 0;
  const { data: newlyLinked } = await db
    .from("zendrop_import_candidates")
    .select("product_id")
    .not("product_id", "is", null)
    .gte("linked_at", new Date(Date.now() - 6 * 3600_000).toISOString())
    .limit(100);
  const productIds = [...new Set(((newlyLinked ?? []) as any[]).map((row) => row.product_id as string))];
  if (productIds.length > 0) {
    const { planWork } = await import("@/lib/intelligence/queue.server");
    seoQueued = (await planWork(db, productIds, "New supplier listing")).queued;
  }

  return {
    message: `Screened ${screen.funnel.queried} supplier products, imported ${imported} of ${queued} queued and booked ${seoQueued} intelligence items. Pricing integrity corrected ${repriced} variant price(s) and held ${heldForPricing} product(s).${
      messages.length > 0 ? ` Issues: ${messages.slice(0, 3).join("; ")}` : ""
    }`,
    details: {
      candidates_found: screen.funnel.queried,
      eligible: screen.funnel.eligible,
      recommended: recommended.length,
      restricted: screen.funnel.restricted,
      category_excluded: screen.funnel.categoryExcluded,
      quality_failed: screen.funnel.qualityFailed,
      uk_unsuitable: screen.funnel.ukUnsuitable,
      pricing_failed: screen.funnel.pricingFailed,
      duplicates: screen.funnel.duplicateExcluded,
      held: selection.held,
      already_known: selection.skipped,
      queued,
      processed,
      imported,
      failed,
      linked,
      seo_queued: seoQueued,
      prohibited_quarantined: quarantined,
      pricing_variants_repriced: repriced,
      pricing_products_held: heldForPricing,
      pricing_non_charm_remaining: nonCharmAfter,
    },
  };
}
