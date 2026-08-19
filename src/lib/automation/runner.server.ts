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
  | "supplier_sourcing_hourly"
  | "prohibited_category_sweep"
  | "live_pricing_integrity"
  | "product_intake_delta_sync"
  | "product_intake_worker"
  | "order_fulfilment_queue"
  | "order_tracking_sync"
  | "supplier_product_refresh";

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
 * Claims a run key so a duplicate invocation of a scheduled job cannot do the
 * work twice. Returns null when the key is already taken.
 */
async function claimRun(
  ctx: RunContext,
  jobKey: string,
  runKey: string,
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
    Date.now() - new Date((existing as any)?.started_at ?? 0).getTime() > 30 * 60_000;
  if (!existing || (status !== "failed" && status !== "cancelled" && !stale)) return null;

  const { data: retaken } = await ctx.supabase
    .from("automation_runs")
    .update({ status: "running", message: null, started_at: new Date().toISOString(), finished_at: null })
    .eq("id", (existing as any).id)
    .select("id")
    .maybeSingle();
  return (retaken as any)?.id ?? null;
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

  const startedAt = new Date().toISOString();
  try {
    const result = await execute(ctx, jobKey);
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
      const report = await runSupplierProductRefresh({ batchSize });
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
 * Hourly supplier sourcing. The run key is dated to the hour so a repeated
 * scheduler call inside the same hour reports the work already happened rather
 * than sourcing twice.
 */
async function runSourcingJob(ctx: RunContext, jobKey: string): Promise<JobRunResult> {
  const runKey = `${jobKey}:${new Date().toISOString().slice(0, 13)}`;
  const runId = await claimRun(ctx, jobKey, runKey);
  if (!runId) {
    return {
      jobKey,
      status: "skipped",
      message: "A sourcing run has already happened for this hour.",
      details: {},
    };
  }
  try {
    const { runHourlySourcing } = await import("@/lib/zendrop/sourcing-job.server");
    const summary = await runHourlySourcing(ctx.supabase, jobKey);
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
  const { resolveShopifyCredentials, syncCatalogue, recordSyncEvent } = await import(
    "@/lib/services/shopify.server"
  );
  const { missing } = await resolveShopifyCredentials();
  if (missing.length > 0) {
    return {
      jobKey: "shopify_catalogue_sync",
      status: "skipped",
      message: `Store credentials are not available yet. Missing: ${missing.join(", ")}.`,
      details: {},
    };
  }

  const result = await syncCatalogue(ctx.supabase);
  await recordSyncEvent(ctx.supabase, {
    status: "success",
    message: `Mirrored ${result.products} products and ${result.collections} collections.`,
    payload: { products: result.products, collections: result.collections },
  });

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
