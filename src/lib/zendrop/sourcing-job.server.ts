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

/** Maximum successful new listings per run. Not a quota to fill. */
export const HOURLY_TARGET = 200;

/** Serial import chunk so one run never fires many heavy jobs at once. */
const IMPORT_CHUNK = 10;

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

/** Wall clock budget for one scheduled pass, well inside the HTTP timeout. */
const DEFAULT_BUDGET_MS = 110_000;

/**
 * Runs one bounded sourcing pass. Safe to call repeatedly: candidate selection
 * is keyed by a stable idempotency key, queueing respects the import cap and
 * the queue drain locks each row before any supplier write.
 *
 * The pass is time boxed. Existing backlog is always drained before new
 * discovery, every phase checks the remaining budget before starting, and the
 * supplier traversal checkpoint is persisted by the screen itself, so a pass
 * that runs out of time still leaves durable progress for the next one.
 */
export async function runHourlySourcing(
  db: Db,
  jobKey: string,
  options?: { budgetMs?: number },
): Promise<SourcingRunSummary> {
  const deadlineAt = Date.now() + Math.max(20_000, options?.budgetMs ?? DEFAULT_BUDGET_MS);
  const remainingMs = () => deadlineAt - Date.now();

  const failures = await consecutiveFailures(db, jobKey);
  if (failures >= BREAKER_THRESHOLD) {
    await tripBreaker(db, jobKey, `${failures} consecutive failed runs were recorded.`);
    return {
      message: "The circuit breaker paused sourcing after repeated failures. Review the run log before resuming.",
      details: { consecutive_failures: failures },
    };
  }

  const { readThrottleStats, resetThrottleStats } = await import("./client.server");
  resetThrottleStats();

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

  const {
    loadSourcingRules,
    runSourcingScreen,
    selectCandidates,
    queueCandidates,
    runImportQueue,
    reconcileImportedCandidates,
    retryHeldCandidates,
  } = await import("./import.server");
  const rules = await loadSourcingRules();
  if (!rules.enabled || !rules.continuous_sourcing) {
    return {
      message: "Continuous sourcing is switched off in the sourcing rules, so nothing was sourced.",
      details: {},
    };
  }

  // Target is the genuine remaining gap to the catalogue goal, never a quota
  // to fill beyond it. Only verified active listings count towards it.
  const { count: activeCount } = await db
    .from("shopify_products")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");
  const goal = Number(rules.target_catalogue_size ?? 0);
  const gap = goal > 0 ? Math.max(0, goal - Number(activeCount ?? 0)) : HOURLY_TARGET;
  const target = Math.max(1, Math.min(rules.batch_size || HOURLY_TARGET, HOURLY_TARGET, gap || 1));
  const atGoal = goal > 0 && gap === 0;

  let processed = 0;
  let imported = 0;
  let failed = 0;
  let queued = 0;
  const messages: string[] = [];

  const drainQueue = async () => {
    for (;;) {
      if (remainingMs() < 20_000) break;
      const outcome = await runImportQueue(IMPORT_CHUNK);
      processed += outcome.processed;
      imported += outcome.imported;
      failed += outcome.failed;
      messages.push(...outcome.messages);
      if (outcome.processed === 0) break;
      if (outcome.imported === 0 && outcome.failed >= outcome.processed) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  };

  // Phase 1. Anything already priced and duplicate checked from an earlier
  // pass is queued and imported before a single new supplier page is read.
  const { data: backlog } = await db
    .from("zendrop_import_candidates")
    .select("id")
    .in("state", ["duplicate_checked", "priced"])
    .limit(200);
  const backlogIds = ((backlog ?? []) as any[]).map((row) => row.id as string);
  let backlogQueued = 0;
  if (backlogIds.length > 0 && !atGoal) {
    backlogQueued = await queueCandidates(backlogIds);
    queued += backlogQueued;
  }
  await drainQueue();

  // Phase 2. Holds that can genuinely change are re-evidenced and released.
  let heldReleased = 0;
  let heldInspected = 0;
  if (remainingMs() > 40_000 && !atGoal) {
    const retry = await retryHeldCandidates({
      limit: 25,
      budgetMs: Math.min(30_000, Math.max(5_000, remainingMs() - 30_000)),
    });
    heldInspected = retry.inspected;
    heldReleased = retry.released;
    if (retry.candidateIds.length > 0) {
      queued += await queueCandidates(retry.candidateIds);
      await drainQueue();
    }
  }

  // Phase 3. New discovery, only with real time left and only up to the gap.
  let screen: Awaited<ReturnType<typeof runSourcingScreen>> | null = null;
  let recommendedCount = 0;
  let held = 0;
  let alreadyKnown = 0;
  if (!atGoal && remainingMs() > 45_000) {
    screen = await runSourcingScreen({
      target,
      checkpoint: true,
      budgetMs: Math.max(15_000, remainingMs() - 35_000),
    });
    const recommended = screen.products
      .filter(
        (product) =>
          (product.outcome === "recommended" || product.outcome === "accepted") &&
          product.score >= rules.min_suitability_score,
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, target);
    recommendedCount = recommended.length;

    if (recommended.length > 0 && remainingMs() > 20_000) {
      const selection = await selectCandidates({
        productIds: recommended.map((product) => product.productId),
        userId: null as unknown as string,
      });
      held = selection.held;
      alreadyKnown = selection.skipped;
      queued += await queueCandidates(selection.candidateIds);
      await drainQueue();
    }
  }

  // Phase 4. Linkage reconciliation for whatever the supplier has pushed. This
  // is what turns an imported candidate into a live listing, so it runs even
  // when the pass found nothing new.
  const reconciled = await reconcileImportedCandidates();
  const linked = reconciled.matched;

  // Search intelligence is booked for newly linked listings and trails
  // asynchronously. It never gates activation.
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

  const throttle = readThrottleStats();

  const message = atGoal
    ? `The catalogue is at its target of ${goal} active listings, so accelerated sourcing stood down and only reconciliation ran. ${reconciled.intakeMessage}`
    : `Queued ${queued} candidate(s) (${backlogQueued} from backlog, ${heldReleased} released holds), imported ${imported} of ${processed} processed and booked ${seoQueued} intelligence items. ${reconciled.intakeMessage}${
        messages.length > 0 ? ` Issues: ${messages.slice(0, 3).join("; ")}` : ""
      }`;

  return {
    message,
    details: {
      active_products: Number(activeCount ?? 0),
      target_catalogue_size: goal,
      remaining_gap: gap,
      candidates_found: screen?.funnel.queried ?? 0,
      eligible: screen?.funnel.eligible ?? 0,
      recommended: recommendedCount,
      restricted: screen?.funnel.restricted ?? 0,
      category_excluded: screen?.funnel.categoryExcluded ?? 0,
      quality_failed: screen?.funnel.qualityFailed ?? 0,
      uk_unsuitable: screen?.funnel.ukUnsuitable ?? 0,
      pricing_failed: screen?.funnel.pricingFailed ?? 0,
      duplicates: screen?.funnel.duplicateExcluded ?? 0,
      held,
      held_inspected: heldInspected,
      held_released: heldReleased,
      already_known: alreadyKnown,
      backlog_queued: backlogQueued,
      queued,
      processed,
      imported,
      failed,
      linked,
      intake_enqueued: reconciled.intakeEnqueued,
      intake_failed: reconciled.intakeFailed,
      seo_queued: seoQueued,
      budget_ms_remaining: Math.max(0, remainingMs()),
      rate_limit_retries: throttle.rateLimitRetries,
      rate_limit_cooldown_seconds: Math.round(throttle.cooldownMs / 1000),
      supplier_server_retries: throttle.serverRetries,
      scan_start_page: screen?.startPage ?? rules.scan_page,
      scan_next_page: screen?.nextPage ?? rules.scan_page,
      scan_pages_read: screen?.pagesRead ?? 0,
      scan_cycle: screen?.cycle ?? rules.scan_cycle,
      scan_wrapped: screen?.wrapped ? 1 : 0,
    },
  };
}

