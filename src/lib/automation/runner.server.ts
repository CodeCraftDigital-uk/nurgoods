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
  | "article_drafting";

export interface JobRunResult {
  jobKey: string;
  status: "succeeded" | "skipped";
  message: string;
  details: Record<string, number | string>;
}

interface RunContext {
  supabase: Db;
  userId: string;
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

  const startedAt = new Date().toISOString();
  try {
    const result = await execute(ctx, jobKey);
    await ctx.supabase
      .from("automation_jobs")
      .update({
        last_run_at: startedAt,
        last_status: result.status === "skipped" ? "cancelled" : "succeeded",
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
    case "article_drafting":
      return {
        jobKey,
        status: "skipped",
        message:
          "Drafting stays under editor control. Open an article in the Journal workspace and run the draft stage there so the output is reviewed before it moves on.",
        details: {},
      };
    default:
      throw new Error("That job has no runner yet");
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
