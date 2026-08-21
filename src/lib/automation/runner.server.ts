import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveAdapter } from "@/lib/ai/runtime.server";

/**
 * Automation runner.
 *
 * Every job here is manually triggerable and records its own outcome on the
 * automation_jobs row so the control plane always shows genuine state rather
 * than decorative status. Nothing publishes factual claims without a person:
 * the scheduler only releases work an editor already approved and scheduled,
 * and topic discovery only produces briefs for review.
 */

type Db = SupabaseClient<any, "public", any>;

export type JobKey =
  | "shopify_catalogue_sync"
  | "seo_audit"
  | "topic_discovery"
  | "publish_scheduler"
  | "article_drafting"
  | "monthly_editorial_plan"
  | "daily_article_publish"
  | "catalogue_intelligence_backfill"
  | "catalogue_intelligence_daily"
  | "catalogue_quality_audit"
  | "catalogue_intelligence_worker"
  | "catalogue_duplicate_identity"
  | "catalogue_seo_sweep"
  | "catalogue_identity_remediation"
  | "supplier_sourcing_hourly"
  | "prohibited_category_sweep"
  | "live_pricing_integrity"
  | "product_intake_delta_sync"
  | "product_intake_worker"
  | "order_fulfilment_queue"
  | "order_tracking_sync"
  | "supplier_product_refresh"
  | "price_authority_sync";

export interface JobRunResult {
  jobKey: string;
  status: "succeeded" | "skipped" | "failed";
  message: string;
  details: Record<string, number | string>;
}

interface RunContext {
  supabase: Db;
  userId: string | null;
}

/**
 * How long a run left in "running" may sit before another invocation may take
 * it over. Long supplier jobs are time boxed to well under two minutes, so an
 * attempt still marked running after five is one that was cut off in flight.
 */
const LONG_JOB_STALE_MS = 5 * 60_000;

/**
 * Claims a run key so a duplicate invocation of a scheduled job cannot do the
 * work twice. Returns null when the key is already taken.
 */
async function claimRun(
  ctx: RunContext,
  jobKey: string,
  runKey: string,
  staleAfterMs = 30 * 60_000,
): Promise<string | null> {

  const { data, error } = await ctx.supabase
    .from("automation_runs")
    .insert({ job_key: jobKey, run_key: runKey, status: "running" } as never)
    .select("id")
    .maybeSingle();
  if (!error) return (data as any)?.id ?? null;

  // The key is taken. A previous attempt that failed or was cancelled may be
  // retried, but work that succeeded or is still running is left alone.
  const { data: existing } = await ctx.supabase
    .from("automation_runs")
    .select("id,status,started_at")
    .eq("run_key", runKey)
    .maybeSingle();
  const status = (existing as any)?.status;
  const stale =
    status === "running" &&
    Date.now() - new Date((existing as any)?.started_at ?? 0).getTime() > staleAfterMs;
  if (!existing || (status !== "failed" && status !== "cancelled" && !stale)) return null;

  const { data: retaken } = await ctx.supabase
    .from("automation_runs")
    .update({ status: "running", message: null, started_at: new Date().toISOString(), finished_at: null })
    .eq("id", (existing as any).id)
    .select("id")
    .maybeSingle();
  return (retaken as any)?.id ?? null;
}

/**
 * Marks run records that were left running by an interrupted invocation as
 * failed once they are well past any plausible execution window. This only
 * corrects bookkeeping: the work itself is idempotent and re-runs on the next
 * schedule, so nothing is duplicated and no supplier spend is triggered.
 */
const ABANDONED_RUN_MS = 60 * 60_000;

/**
 * How long a job may report itself as running before the record is treated as
 * the leftover of an invocation that was cut off. Every job is time boxed well
 * below this, so nothing legitimate is ever marked failed while still working.
 */
const ABANDONED_JOB_MS = 15 * 60_000;

async function reclaimAbandonedRuns(ctx: RunContext): Promise<void> {
  try {
    await ctx.supabase
      .from("automation_jobs")
      .update({
        last_status: "failed",
        last_result: {
          message: "Recovered: the run was interrupted before it could report a result.",
        },
      } as never)
      .eq("last_status", "running")
      .lt("last_run_at", new Date(Date.now() - ABANDONED_JOB_MS).toISOString());
  } catch {
    // Bookkeeping only.
  }
  try {
    await ctx.supabase
      .from("automation_runs")
      .update({
        status: "failed",
        message: "Recovered: the run was interrupted before it could report a result.",
        finished_at: new Date().toISOString(),
      } as never)
      .eq("status", "running")
      .lt("started_at", new Date(Date.now() - ABANDONED_RUN_MS).toISOString());
  } catch {
    // Bookkeeping only. It must never stop a job from doing its real work.
  }
}

async function closeRun(
  ctx: RunContext,
  runId: string,
  status: "succeeded" | "failed" | "cancelled",
  message: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await ctx.supabase
    .from("automation_runs")
    .update({
      status,
      message,
      details: details as never,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);
}

/**
 * Jobs whose work changes what customers may see. Each one rebuilds the
 * storefront projection when it finishes so the shop is never stale.
 */
const SNAPSHOT_AFFECTING_JOBS = new Set([
  "shopify_catalogue_sync",
  "product_intake_worker",
  "product_intake_delta_sync",
  "catalogue_duplicate_identity",
  "catalogue_identity_remediation",
  "catalogue_intelligence_worker",
  "catalogue_intelligence_backfill",
  "catalogue_seo_sweep",
  "live_pricing_integrity",
  "prohibited_category_sweep",
  "price_authority_sync",
]);

/**
 * Jobs that bring store catalogue data inward. The store is authoritative for
 * status and for the retail price, so once a mirror pass lands the pricing
 * worker re-measures cost of goods and corrects any variant that drifted away
 * from the canonical formula.
 */
const PRICE_AUTHORITY_TRIGGERS = new Set([
  "shopify_catalogue_sync",
  "product_intake_delta_sync",
]);


export async function runAutomationJob(
  ctx: RunContext,
  jobKey: string,
): Promise<JobRunResult> {
  const { data: job, error } = await ctx.supabase
    .from("automation_jobs")
    .select("*")
    .eq("job_key", jobKey)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!job) throw new Error("That automation job does not exist");
  if (job.enabled === false) {
    return {
      jobKey,
      status: "skipped",
      message: "This job is paused. Resume it to let it run again.",
      details: {},
    };
  }

  // Close out run records abandoned by an invocation that was cut off before
  // it could finish. They spend no work and hold no claim once expired, but
  // left as running they hide the true health of the schedule.
  await reclaimAbandonedRuns(ctx);

  const startedAt = new Date().toISOString();

  // Stamped before the work starts, so an invocation that is cut off by its
  // caller still shows honestly as attempted rather than leaving the console
  // reporting the last completed run as though nothing had been tried since.
  await ctx.supabase
    .from("automation_jobs")
    .update({
      last_run_at: startedAt,
      last_status: "running",
      last_result: { message: "The run started." },
    })
    .eq("id", job.id);

  try {

    const result = await execute(ctx, jobKey);
    if (result.status === "succeeded" && PRICE_AUTHORITY_TRIGGERS.has(jobKey)) {
      // Incoming catalogue data may carry a supplier or store originated price.
      // It is never accepted as authoritative: drift is detected and a bounded
      // correction is pushed straight back out.
      const { runPriceAuthorityCycle } = await import("@/lib/pricing/authority.server");
      await runPriceAuthorityCycle({ pushLimit: 30 }).catch(() => undefined);
    }
    if (result.status === "succeeded" && SNAPSHOT_AFFECTING_JOBS.has(jobKey)) {
      // Customer facing pages read a projection, so it is rebuilt as soon as
      // the catalogue behind it changes rather than only on its own schedule.
      const { refreshStorefrontSnapshot } = await import("./snapshot.server");
      await refreshStorefrontSnapshot(ctx.supabase as any, "storefront_snapshot_refresh").catch(
        () => undefined,
      );
    }
    await ctx.supabase
      .from("automation_jobs")
      .update({
        last_run_at: startedAt,
        last_status:
          result.status === "skipped"
            ? "cancelled"
            : result.status === "failed"
              ? "failed"
              : "succeeded",
        last_result: { message: result.message, ...result.details },
      })
      .eq("id", job.id);
    return result;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The job failed";
    await ctx.supabase
      .from("automation_jobs")
      .update({
        last_run_at: startedAt,
        last_status: "failed",
        last_result: { message },
      })
      .eq("id", job.id);
    throw new Error(message);
  }
}

async function execute(ctx: RunContext, jobKey: string): Promise<JobRunResult> {
  switch (jobKey) {
    case "shopify_catalogue_sync":
      return runCatalogueSync(ctx);
    case "seo_audit":
      return runSeoAudit(ctx);
    case "topic_discovery":
      return runTopicDiscovery(ctx);
    case "publish_scheduler":
      return runPublishScheduler(ctx);
    case "monthly_editorial_plan":
      return runMonthlyPlan(ctx);
    case "daily_article_publish":
      return runDailyPublish(ctx);
    case "catalogue_intelligence_backfill":
      return runIntelligenceJob(ctx, jobKey, `${jobKey}:${Date.now()}`);
    case "catalogue_intelligence_daily":
      return runIntelligenceJob(ctx, jobKey, `${jobKey}:${new Date().toISOString().slice(0, 10)}`);
    case "catalogue_quality_audit":
      return runIntelligenceJob(ctx, jobKey, `${jobKey}:${isoWeek()}`);
    case "catalogue_intelligence_worker":
      return runIntelligenceJob(ctx, jobKey, `${jobKey}:${Date.now()}`);
    case "catalogue_duplicate_identity":
      return runIntelligenceJob(ctx, jobKey, `${jobKey}:${Date.now()}`);
    case "catalogue_seo_sweep":
      return runIntelligenceJob(ctx, jobKey, `${jobKey}:${Date.now()}`);
    case "catalogue_identity_remediation":
      return runIntelligenceJob(ctx, jobKey, `${jobKey}:${Date.now()}`);
    case "prohibited_category_sweep": {
      const { quarantineProhibitedCatalogue } = await import("@/lib/policy/quarantine.server");
      const report = await quarantineProhibitedCatalogue();
      return {
        jobKey,
        status: "succeeded",
        message: `Scanned ${report.scanned} products. ${report.flagged} prohibited, ${report.quarantined} quarantined.`,
        details: {
          scanned: report.scanned,
          flagged: report.flagged,
          quarantined: report.quarantined,
          failures: report.failures,
        },
      };
    }
    case "live_pricing_integrity": {
      // Reads prices straight from the commerce system rather than the local
      // mirror, so a supplier push that lands after the last sync cannot leave
      // an unjustified price on sale until someone notices.
      const { enforceLivePricingIntegrity } = await import("@/lib/pricing/integrity.server");
      const report = await enforceLivePricingIntegrity({ userId: ctx.userId });
      return {
        jobKey,
        status: report.failures > 0 || report.nonCharmAfter > 0 ? "failed" : "succeeded",
        message: report.message,
        details: {
          active_products: report.activeProducts,
          active_variants: report.activeVariants,
          non_charm_before: report.nonCharmBefore,
          non_charm_after: report.nonCharmAfter,
          variants_repriced: report.variantsRepriced,
          products_held: report.productsHeld,
          read_back_mismatches: report.readBackMismatches,
          failures: report.failures,
        },
      };
    }
    case "supplier_sourcing_hourly":
      return runSourcingJob(ctx, jobKey);
    case "product_intake_delta_sync":
    case "product_intake_worker":
      return runIntakeJob(ctx, jobKey);
    case "order_fulfilment_queue": {
      // Places supplier orders only for store orders the store itself reports
      // as paid, and only when fulfilment has been authorised.
      const { runOrderFulfilmentQueue } = await import("@/lib/commerce/jobs.server");
      const report = await runOrderFulfilmentQueue(ctx.supabase as never);
      return {
        jobKey,
        status: report.ok ? "succeeded" : "failed",
        message: report.message,
        details: report.detail as Record<string, string | number>,
      };
    }
    case "supplier_product_refresh": {
      // Keeps listings that are already on sale honest: refreshed supplier
      // cost, refreshed per market shipping evidence, recalculated price, and
      // an automatic hold when the supplier can no longer evidence stock,
      // delivery or profitability. Read only against the supplier.
      const { runSupplierProductRefresh } = await import("@/lib/zendrop/supplier-refresh.server");
      const { data: refreshJob } = await ctx.supabase
        .from("automation_jobs")
        .select("config")
        .eq("job_key", jobKey)
        .maybeSingle();
      const batchSize = Number((refreshJob as any)?.config?.batch_size) || 25;
      const budgetMs = Number((refreshJob as any)?.config?.budget_ms) || 110_000;
      const report = await runSupplierProductRefresh({ batchSize, budgetMs });

      return {
        jobKey,
        status: "succeeded",
        message: report.message,
        details: {
          inspected: report.inspected,
          healthy: report.healthy,
          repriced: report.repriced,
          held: report.held,
          errored: report.errored,
        },
      };
    }
    case "order_tracking_sync": {
      const { runOrderTrackingSync } = await import("@/lib/commerce/jobs.server");
      const report = await runOrderTrackingSync(ctx.supabase as never);
      return {
        jobKey,
        status: report.ok ? "succeeded" : "failed",
        message: report.message,
        details: report.detail as Record<string, string | number>,
      };
    }

    // Retired by the Shopify led architecture and disabled in the schedule.
    // Kept callable so an operator can still run a one off recovery by hand.
    case "supplier_link_recovery": {
      // Rebuilds supplier mappings from supplier reported store ids only.
      // Nothing is inferred from titles and no order is ever placed.
      const { recoverSupplierLinkage } = await import("@/lib/pricing/linkage.server");
      const result = await recoverSupplierLinkage();
      return {
        jobKey,
        status: "succeeded",
        message: result.message,
        details: {
          linked: result.linkedProducts,
          unmatched: result.unmatchedSupplierProducts,
          shipping_quoted: result.shippingQuoted,
        },
      };
    }

    // Retired by the Shopify led architecture and disabled in the schedule.
    // Catalogue time deliverability is now filtered by the supplier before a
    // product reaches the store. It only ever removes channels when run.
    case "sellability_hold_sweep": {
      const { enforceSellabilityHold } = await import("@/lib/intake/sellability.server");
      const result = await enforceSellabilityHold({ apply: true, limit: 50 });
      return {
        jobKey,
        status: result.failed.length > 0 ? "failed" : "succeeded",
        message: result.message,
        details: {
          attempted: result.attempted,
          held_off: result.heldOff,
          already_off: result.alreadyOff,
          failed: result.failed.length,
        },
      };
    }

    case "price_authority_sync": {
      // The pricing worker. It reads store cost of goods for a bounded page of
      // the catalogue, calculates the NUR GOODS retail price and writes it back
      // to the store variants so the Online Store, the Shop channel and the
      // headless website all show one price. Bounded and resumable, so it walks
      // the whole catalogue, drafts included, over successive runs.
      const { runPriceAuthorityCycle } = await import("@/lib/pricing/authority.server");
      const { syncApprovedFormulaVersion, pricingGateStats } = await import(
        "@/lib/pricing/gate.server"
      );
      const { runPricingLifecycleRetries } = await import("@/lib/pricing/lifecycle.server");
      await syncApprovedFormulaVersion();
      const cycle = await runPriceAuthorityCycle({ pushLimit: 30 });
      // The lifecycle retry pass: anything pending, held or in error gets a
      // bounded new attempt, and anything newly verified is activated and
      // published by the same service.
      const lifecycle = await runPricingLifecycleRetries(15).catch(() => null);
      const gate = await pricingGateStats().catch(() => null);

      return {
        jobKey,
        status: cycle.reprice.failed > 0 ? "failed" : "succeeded",
        message: cycle.reprice.message,
        details: {
          products: cycle.reprice.products,
          variants: cycle.reprice.variants,
          in_sync: cycle.reprice.inSync,
          repriced: cycle.reprice.repriced,
          held: cycle.reprice.held,
          push_failed: cycle.reprice.failed,
          compare_at_cleared: cycle.reprice.compareAtCleared,
          full_pass_complete: cycle.finishedFullPass ? 1 : 0,
          parity_mirror_mismatches: cycle.parity.mirrorMismatches,
          parity_non_charm: cycle.parity.nonCharm,
          parity_legacy_rows: cycle.parity.legacyRows,
          gate_pending: gate?.pending ?? -1,
          gate_held: gate?.held ?? -1,
          gate_verified: gate?.verified ?? -1,
          gate_drift: gate?.drift ?? -1,
          gate_products_blocked: gate?.products_blocked ?? -1,
          lifecycle_evaluated: lifecycle?.evaluated ?? 0,
          lifecycle_verified: lifecycle?.verified ?? 0,
          lifecycle_held: lifecycle?.held ?? 0,
          lifecycle_errored: lifecycle?.errored ?? 0,
          lifecycle_activated: lifecycle?.activated ?? 0,
          lifecycle_drafted: lifecycle?.drafted ?? 0,

        },
      };
    }



    case "storefront_snapshot_refresh": {
      const { refreshStorefrontSnapshot } = await import("./snapshot.server");
      return refreshStorefrontSnapshot(ctx.supabase as any, jobKey);
    }

    case "article_drafting":
      return {
        jobKey,
        status: "skipped",
        message:
          "Automatic drafting now runs on the daily Journal job. Use that job, or open an article in the Journal workspace to run a single stage by hand.",
        details: {},
      };
    default:
      throw new Error("That job has no runner yet");
  }
}

/* --------------------- catalogue and seo intelligence --------------------- */

/** ISO week key so the weekly audit claims one run per week. */
function isoWeek(): string {
  const now = new Date();
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Runs one intelligence job under a claimed run key. The backfill claims a
 * fresh key each pass because it is designed to be called repeatedly until the
 * queue drains, while the daily and weekly jobs claim a dated key so a
 * duplicated scheduler call cannot repeat the work.
 */
async function runIntelligenceJob(
  ctx: RunContext,
  jobKey: string,
  runKey: string,
): Promise<JobRunResult> {
  const runId = await claimRun(ctx, jobKey, runKey);
  if (!runId) {
    return {
      jobKey,
      status: "skipped",
      message: "This intelligence run has already happened for this period.",
      details: {},
    };
  }

  try {
    const {
      runBackfill,
      runDailyMaintenance,
      runQualityAudit,
      runIntelligenceWorker,
      runIdentityJob,
      runSeoSweep,
      runIdentityRemediation,

    } = await import("@/lib/intelligence/jobs.server");
    const { data: job } = await ctx.supabase
      .from("automation_jobs")
      .select("config")
      .eq("job_key", jobKey)
      .maybeSingle();
    const batchSize = Number((job as any)?.config?.batch_size) || undefined;

    const summary =
      jobKey === "catalogue_intelligence_backfill"
        ? await runBackfill(ctx.supabase, batchSize ?? 8)
        : jobKey === "catalogue_intelligence_daily"
          ? await runDailyMaintenance(ctx.supabase, batchSize ?? 12)
          : jobKey === "catalogue_intelligence_worker"
            ? await runIntelligenceWorker(ctx.supabase, batchSize ?? 10)
            : jobKey === "catalogue_duplicate_identity"
              ? await runIdentityJob(ctx.supabase)
              : jobKey === "catalogue_seo_sweep"
                ? await runSeoSweep(ctx.supabase, batchSize ?? 10)
                : jobKey === "catalogue_identity_remediation"
                  ? await runIdentityRemediation(ctx.supabase, batchSize ?? 100)
                  : await runQualityAudit(ctx.supabase);

    await closeRun(ctx, runId, "succeeded", summary.message, summary.details);
    return { jobKey, status: "succeeded", message: summary.message, details: summary.details };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The intelligence job failed";
    await closeRun(ctx, runId, "failed", message);
    throw new Error(message);
  }
}

/**
 * Bounded supplier sourcing pass.
 *
 * The run key is bucketed so a duplicated scheduler call inside the same
 * window cannot source twice, but an attempt that was cut off mid flight is
 * reclaimed quickly rather than blocking the rest of the window. The pass
 * itself is time boxed and persists its own checkpoint, so a window is only
 * ever recorded as completed after genuine, durable progress.
 */
async function runSourcingJob(ctx: RunContext, jobKey: string): Promise<JobRunResult> {
  // Fifteen minute run buckets. The catalogue traversal is checkpointed, so a
  // more frequent schedule walks deeper rather than repeating work, while the
  // bucket still stops a duplicated scheduler call inside the same window.
  const now = new Date();
  const bucket = `${now.toISOString().slice(0, 13)}:${String(Math.floor(now.getUTCMinutes() / 15) * 15).padStart(2, "0")}`;
  const runKey = `${jobKey}:${bucket}`;
  const runId = await claimRun(ctx, jobKey, runKey, LONG_JOB_STALE_MS);
  if (!runId) {
    return {
      jobKey,
      status: "skipped",
      message: "A sourcing run has already happened in this window.",
      details: {},
    };
  }
  try {
    const { data: sourcingJob } = await ctx.supabase
      .from("automation_jobs")
      .select("config")
      .eq("job_key", jobKey)
      .maybeSingle();
    const budgetMs = Number((sourcingJob as any)?.config?.budget_ms) || 110_000;
    const { runHourlySourcing } = await import("@/lib/zendrop/sourcing-job.server");
    const summary = await runHourlySourcing(ctx.supabase, jobKey, { budgetMs });
    await closeRun(ctx, runId, "succeeded", summary.message, summary.details);
    return { jobKey, status: "succeeded", message: summary.message, details: summary.details };

  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The sourcing job failed";
    await closeRun(ctx, runId, "failed", message);
    throw new Error(message);
  }
}

/* ------------------------- automated journal ------------------------- */

/** Builds the forward topic plan for the current month, once per month. */
async function runMonthlyPlan(ctx: RunContext): Promise<JobRunResult> {
  const jobKey = "monthly_editorial_plan";
  const runKey = `${jobKey}:${new Date().toISOString().slice(0, 7)}`;
  const runId = await claimRun(ctx, jobKey, runKey);
  if (!runId) {
    return {
      jobKey,
      status: "skipped",
      message: "The plan for this month has already been built.",
      details: {},
    };
  }

  try {
    const { planMonthlyEditorial } = await import("./editorial.server");
    const result = await planMonthlyEditorial(ctx.supabase, { userId: ctx.userId });
    const message = `Planned ${result.created} topics for ${result.month}.`;
    await closeRun(ctx, runId, "succeeded", message, { ...result });
    return { jobKey, status: "succeeded", message, details: { created: result.created } };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The planner failed";
    await closeRun(ctx, runId, "failed", message);
    throw new Error(message);
  }
}

/** Writes, checks and publishes the next planned article, once per day. */
async function runDailyPublish(ctx: RunContext): Promise<JobRunResult> {
  const jobKey = "daily_article_publish";
  const runKey = `${jobKey}:${new Date().toISOString().slice(0, 10)}`;
  const runId = await claimRun(ctx, jobKey, runKey);
  if (!runId) {
    return {
      jobKey,
      status: "skipped",
      message: "Today's Journal run has already happened.",
      details: {},
    };
  }

  try {
    const { runDailyArticle } = await import("./editorial.server");
    const result = await runDailyArticle(ctx.supabase, { userId: ctx.userId });
    await closeRun(
      ctx,
      runId,
      result.status === "published" ? "succeeded" : result.status === "skipped" ? "cancelled" : "failed",
      result.message,
      { articleId: result.articleId ?? null, slug: result.slug ?? null },
    );
    return {
      jobKey,
      status:
        result.status === "published"
          ? "succeeded"
          : result.status === "skipped"
            ? "skipped"
            : "failed",
      message: result.message,
      details: result.slug ? { slug: result.slug } : {},
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The daily Journal run failed";
    await closeRun(ctx, runId, "failed", message);
    throw new Error(message);
  }
}

/* --------------------------- catalogue sync --------------------------- */

async function runCatalogueSync(ctx: RunContext): Promise<JobRunResult> {
  const {
    resolveShopifyCredentials,
    syncCatalogue,
    recordSyncEvent,
    markConnectionState,
    isTransientShopifyError,
  } = await import("@/lib/services/shopify.server");
  const { missing } = await resolveShopifyCredentials();
  if (missing.length > 0) {
    return {
      jobKey: "shopify_catalogue_sync",
      status: "skipped",
      message: `Store credentials are not available yet. Missing: ${missing.join(", ")}.`,
      details: {},
    };
  }

  let result: Awaited<ReturnType<typeof syncCatalogue>>;
  try {
    result = await syncCatalogue(ctx.supabase);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Catalogue sync failed";
    await recordSyncEvent(ctx.supabase, { status: "failed", message });
    await markConnectionState({
      state: isTransientShopifyError(message) ? "connected" : "error",
      error: message,
    });
    throw new Error(message);
  }
  await recordSyncEvent(ctx.supabase, {
    status: "success",
    message: `Mirrored ${result.products} products and ${result.collections} collections.`,
    payload: { products: result.products, collections: result.collections },
  });
  // A successful scheduled run is what clears a stale error banner in admin.
  await markConnectionState({ state: "connected", error: null, syncedAt: result.syncedAt });


  // Legal and policy wording changes rarely, so it rides along with the
  // catalogue run rather than adding a second schedule of API calls.
  let legalNote = "";
  try {
    const { syncLegalContent } = await import("@/lib/services/shopify-legal.server");
    const legal = await syncLegalContent(ctx.supabase);
    legalNote = legal.scopeAction
      ? ` Legal sync needs new app scopes: ${legal.scopeAction}`
      : ` Imported ${legal.imported} legal documents, ${legal.needsReview} need owner review.`;
    await recordSyncEvent(ctx.supabase, {
      eventType: "legal_sync",
      status: legal.scopeAction ? "failed" : "success",
      message: legalNote.trim(),
      payload: { imported: legal.imported, needs_review: legal.needsReview },
    });
  } catch (error) {
    legalNote = ` Legal sync did not run: ${error instanceof Error ? error.message : "unknown error"}`;
    await recordSyncEvent(ctx.supabase, {
      eventType: "legal_sync",
      status: "failed",
      message: legalNote.trim(),
    });
  }

  return {
    jobKey: "shopify_catalogue_sync",
    status: "succeeded",
    message: `Mirrored ${result.products} products and ${result.collections} collections. The store remains the source of truth.${legalNote}`,
    details: { products: result.products, collections: result.collections },
  };
}

/* ------------------------------ seo audit ------------------------------ */

async function runSeoAudit(ctx: RunContext): Promise<JobRunResult> {
  const { syncSeoCoverage } = await import("@/lib/ai/seo.server");
  const coverage = await syncSeoCoverage(ctx.supabase);

  const { data: records, error } = await ctx.supabase
    .from("seo_records")
    .select("optimisation_status,meta_title,meta_description,target_query");
  if (error) throw new Error(error.message);

  const rows = records ?? [];
  const missingMetadata = rows.filter((row) => !row.meta_title || !row.meta_description).length;
  const missingQuery = rows.filter((row) => !row.target_query).length;
  const needsReview = rows.filter((row) => row.optimisation_status === "needs_review").length;

  return {
    jobKey: "seo_audit",
    status: "succeeded",
    message: coverage.skipped
      ? coverage.skipped.reason
      : `${coverage.created} new record${coverage.created === 1 ? "" : "s"} added. ${missingMetadata} awaiting metadata, ${missingQuery} without a target query, ${needsReview} awaiting review.`,
    details: {
      created: coverage.created,
      covered: coverage.existing,
      missingMetadata,
      missingQuery,
      needsReview,
    },
  };
}

/* --------------------------- publish scheduler -------------------------- */

async function runPublishScheduler(ctx: RunContext): Promise<JobRunResult> {
  const now = new Date().toISOString();
  const { data: due, error } = await ctx.supabase
    .from("articles")
    .select("id,title,scheduled_for,sources_verified")
    .eq("status", "scheduled")
    .lte("scheduled_for", now);
  if (error) throw new Error(error.message);

  const ready = (due ?? []).filter((article) => article.sources_verified);
  const held = (due ?? []).length - ready.length;

  for (const article of ready) {
    const { error: updateError } = await ctx.supabase
      .from("articles")
      .update({ status: "published", stage: "scheduling", published_at: now })
      .eq("id", article.id);
    if (updateError) throw new Error(updateError.message);
  }

  return {
    jobKey: "publish_scheduler",
    status: "succeeded",
    message:
      ready.length === 0 && held === 0
        ? "Nothing is due for release right now."
        : `Released ${ready.length} scheduled article${ready.length === 1 ? "" : "s"}.${held > 0 ? ` ${held} held back because sources are not verified yet.` : ""}`,
    details: { released: ready.length, held },
  };
}

/* ---------------------------- topic discovery --------------------------- */

const TOPIC_RULES = [
  "You plan editorial topics for NUR GOODS, a premium and calm retail brand.",
  "Tagline: Good things, brought to light.",
  "Never invent products, prices, reviews, statistics or news.",
  "Only reference catalogue items supplied in the context.",
  "Write in British English. Never use em dashes.",
  "Topics must be genuinely useful to a shopper and commercially relevant.",
].join(" ");

interface TopicSuggestion {
  title: string;
  targetQuery: string;
  searchIntent: string;
  audience: string;
  angle: string;
  requiresLiveResearch: boolean;
}

async function runTopicDiscovery(ctx: RunContext): Promise<JobRunResult> {
  const [products, collections, briefs, articles] = await Promise.all([
    ctx.supabase.from("shopify_products").select("title,product_type,tags").limit(60),
    ctx.supabase.from("shopify_collections").select("title,description").limit(40),
    ctx.supabase.from("article_briefs").select("title"),
    ctx.supabase.from("articles").select("title"),
  ]);

  const firstError =
    products.error ?? collections.error ?? briefs.error ?? articles.error ?? null;
  if (firstError) throw new Error(firstError.message);

  const catalogue = [
    ...(products.data ?? []).map(
      (row) => `Product: ${row.title}${row.product_type ? ` (${row.product_type})` : ""}`,
    ),
    ...(collections.data ?? []).map((row) => `Collection: ${row.title}`),
  ];

  if (catalogue.length === 0) {
    return {
      jobKey: "topic_discovery",
      status: "skipped",
      message:
        "There is no catalogue data to plan against yet. Connect the store and run a catalogue sync first.",
      details: {},
    };
  }

  const existing = [
    ...(briefs.data ?? []).map((row) => row.title),
    ...(articles.data ?? []).map((row) => row.title),
  ];

  const adapter = resolveAdapter();
  const completion = await adapter.complete({
    stage: "topic_discovery",
    promptVersionKey: "topic_discovery.v1",
    messages: [
      { role: "system", content: TOPIC_RULES },
      {
        role: "user",
        content: [
          "Catalogue context:",
          catalogue.join("\n"),
          "",
          existing.length > 0
            ? `Already covered, do not repeat:\n${existing.join("\n")}`
            : "Nothing is covered yet.",
          "",
          "Propose five Journal topics. Return JSON only in the shape:",
          '{"topics":[{"title":"","targetQuery":"","searchIntent":"","audience":"","angle":"","requiresLiveResearch":false}]}',
          "Set requiresLiveResearch to true only when the topic depends on current events, prices or news.",
        ].join("\n"),
      },
    ],
    responseSchema: {},
    temperature: 0.6,
  });

  const parsed = completion.parsed as { topics?: TopicSuggestion[] } | undefined;
  const topics = (parsed?.topics ?? []).filter((topic) => topic?.title?.trim());
  if (topics.length === 0) throw new Error("No usable topics were returned");

  const seen = new Set(existing.map((title) => title.toLowerCase().trim()));
  const fresh = topics.filter((topic) => !seen.has(topic.title.toLowerCase().trim()));

  if (fresh.length > 0) {
    const { error } = await ctx.supabase.from("article_briefs").insert(
      fresh.map((topic) => ({
        title: topic.title.trim(),
        target_query: topic.targetQuery ?? null,
        search_intent: topic.searchIntent ?? null,
        audience: topic.audience ?? null,
        angle: topic.angle ?? null,
        requires_live_research: Boolean(topic.requiresLiveResearch),
        status: "draft",
        stage: "topic_discovery",
        created_by: ctx.userId,
      })),
    );
    if (error) throw new Error(error.message);
  }

  await ctx.supabase.from("ai_generation_runs").insert({
    stage: "topic_discovery",
    status: "succeeded",
    entity_type: "automation_job",
    provider: completion.provider,
    model: completion.model,
    input: { catalogueItems: catalogue.length },
    output: { topics: fresh.map((topic) => topic.title) },
    used_live_research: false,
    token_input: completion.tokenInput ?? null,
    token_output: completion.tokenOutput ?? null,
    created_by: ctx.userId,
    completed_at: new Date().toISOString(),
  });

  return {
    jobKey: "topic_discovery",
    status: "succeeded",
    message: `${fresh.length} new brief${fresh.length === 1 ? "" : "s"} added for review. Nothing is drafted or published automatically.`,
    details: { created: fresh.length, suggested: topics.length },
  };
}

/* --------------------------- product intake --------------------------- */

/**
 * Runs an intake job under a claimed run key. The delta sync claims a dated
 * key so a repeated scheduler call cannot re-pull the same window, while the
 * worker claims a fresh key because it is designed to be called repeatedly
 * until the queue drains.
 */
async function runIntakeJob(ctx: RunContext, jobKey: string): Promise<JobRunResult> {
  const runKey =
    jobKey === "product_intake_delta_sync"
      ? `${jobKey}:${new Date().toISOString().slice(0, 13)}`
      : `${jobKey}:${Date.now()}`;
  const runId = await claimRun(ctx, jobKey, runKey);
  if (!runId) {
    return {
      jobKey,
      status: "skipped",
      message: "This intake run has already happened for this period.",
      details: {},
    };
  }

  try {
    const { runIntakeDeltaSync, runIntakeWorker } = await import("@/lib/intake/jobs.server");
    const { data: job } = await ctx.supabase
      .from("automation_jobs")
      .select("config")
      .eq("job_key", jobKey)
      .maybeSingle();
    const batchSize = Number((job as any)?.config?.batch_size) || undefined;

    const summary =
      jobKey === "product_intake_delta_sync"
        ? await runIntakeDeltaSync(ctx.supabase)
        : await runIntakeWorker(ctx.supabase, batchSize ?? 6);

    await closeRun(ctx, runId, "succeeded", summary.message, summary.details);
    return { jobKey, status: "succeeded", message: summary.message, details: summary.details };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The intake job failed";
    await closeRun(ctx, runId, "failed", message);
    throw new Error(message);
  }
}
