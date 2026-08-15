import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveAdapter } from "./runtime.server";

/**
 * SEO intelligence runtime.
 *
 * Two jobs live here. Coverage sync mirrors real catalogue and Journal rows
 * into seo_records so the control plane always reflects actual state. Plan
 * generation drafts query, intent, entities, metadata and answerable questions
 * for one record using the managed AI service.
 *
 * Nothing is auto approved. Generated plans land as needs_review so a person
 * confirms the wording before it is treated as optimised.
 */

type Db = SupabaseClient<any, "public", any>;

export interface SeoCoverageResult {
  created: number;
  existing: number;
  skipped: { reason: string } | null;
}

interface CoverageCandidate {
  target_type: "article" | "product" | "collection";
  target_reference: string;
  target_label: string;
}

export async function syncSeoCoverage(supabase: Db): Promise<SeoCoverageResult> {
  const [articles, products, collections, records] = await Promise.all([
    supabase.from("articles").select("slug,title"),
    supabase.from("shopify_products").select("handle,title"),
    supabase.from("shopify_collections").select("handle,title"),
    supabase.from("seo_records").select("target_type,target_reference"),
  ]);

  const firstError = articles.error ?? products.error ?? collections.error ?? records.error;
  if (firstError) throw new Error(firstError.message);

  const candidates: CoverageCandidate[] = [
    ...(articles.data ?? []).map((row) => ({
      target_type: "article" as const,
      target_reference: row.slug,
      target_label: row.title,
    })),
    ...(products.data ?? []).map((row) => ({
      target_type: "product" as const,
      target_reference: row.handle,
      target_label: row.title,
    })),
    ...(collections.data ?? []).map((row) => ({
      target_type: "collection" as const,
      target_reference: row.handle,
      target_label: row.title,
    })),
  ];

  const seen = new Set(
    (records.data ?? []).map((row) => `${row.target_type}:${row.target_reference}`),
  );
  const missing = candidates.filter(
    (candidate) => !seen.has(`${candidate.target_type}:${candidate.target_reference}`),
  );

  if (missing.length > 0) {
    const { error } = await supabase.from("seo_records").insert(missing);
    if (error) throw new Error(error.message);
  }

  return {
    created: missing.length,
    existing: candidates.length - missing.length,
    skipped:
      candidates.length === 0
        ? {
            reason:
              "There is no Journal or catalogue content to cover yet. Publish an article or connect the store catalogue first.",
          }
        : null,
  };
}

const SEO_RULES = [
  "You plan search, answer engine and assistant visibility for NUR GOODS, a calm premium retail brand.",
  "Tagline: Good things, brought to light.",
  "Never use em dashes.",
  "Never invent products, prices, reviews, certifications, statistics or claims.",
  "Only use the supplied target content. If something is unknown, leave the field empty rather than guessing.",
  "Meta title under 60 characters. Meta description under 160 characters.",
  "Questions must be ones a real shopper would ask, with short factual answers grounded in the supplied content.",
  "Return strict JSON only, with no commentary and no code fences.",
].join(" ");

const SEO_INSTRUCTION = [
  "Produce an SEO, AEO and assistant readiness plan for the target below.",
  'Return JSON {"target_query": string, "search_intent": string, "secondary_queries": string[],',
  '"meta_title": string, "meta_description": string, "schema_type": string,',
  '"questions": [{"question": string, "answer": string}]}.',
  "Give at most six secondary queries and at most six questions.",
].join(" ");

export interface SeoPlanResult {
  runId: string;
  applied: string[];
  questionsAdded: number;
}

async function loadTargetContext(supabase: Db, record: {
  target_type: string;
  target_reference: string;
  target_label: string | null;
}) {
  if (record.target_type === "article") {
    const { data } = await supabase
      .from("articles")
      .select("title,excerpt,body_markdown,tags,faqs,status")
      .eq("slug", record.target_reference)
      .maybeSingle();
    return data;
  }
  if (record.target_type === "product") {
    const { data: product } = await supabase
      .from("shopify_products")
      .select("id,title,product_type,vendor,tags,price_min,price_max,currency")
      .eq("handle", record.target_reference)
      .maybeSingle();
    if (!product) return null;
    const { data: enrichment } = await supabase
      .from("product_enrichment")
      .select("summary,long_description,benefits,use_cases,specifications,faqs")
      .eq("product_id", product.id)
      .maybeSingle();
    return { product, enrichment };
  }
  if (record.target_type === "collection") {
    const { data } = await supabase
      .from("shopify_collections")
      .select("title,description,product_count")
      .eq("handle", record.target_reference)
      .maybeSingle();
    return data;
  }
  return { label: record.target_label, reference: record.target_reference };
}

export async function runSeoPlan(
  supabase: Db,
  input: { recordId: string; userId: string },
): Promise<SeoPlanResult> {
  const { data: record, error: recordError } = await supabase
    .from("seo_records")
    .select("*")
    .eq("id", input.recordId)
    .single();
  if (recordError || !record) throw new Error("SEO record not found");

  const target = await loadTargetContext(supabase, record);
  if (!target) {
    throw new Error(
      "The linked content could not be found, so nothing can be planned without inventing detail.",
    );
  }

  const { data: run, error: runError } = await supabase
    .from("ai_generation_runs")
    .insert({
      stage: "metadata_schema",
      entity_type: "seo_record",
      entity_id: input.recordId,
      status: "running",
      started_at: new Date().toISOString(),
      created_by: input.userId,
      input: { targetType: record.target_type, targetReference: record.target_reference },
    })
    .select("id")
    .single();
  if (runError || !run) throw new Error(runError?.message ?? "Could not record the run");

  try {
    const adapter = resolveAdapter();
    const result = await adapter.complete({
      stage: "metadata_schema",
      promptVersionKey: "seo.plan",
      responseSchema: {},
      messages: [
        { role: "system", content: SEO_RULES },
        {
          role: "user",
          content: `${SEO_INSTRUCTION}\n\n${JSON.stringify({
            target_type: record.target_type,
            target_reference: record.target_reference,
            target_label: record.target_label,
            existing_query: record.target_query,
            target,
          })}`,
        },
      ],
    });

    const parsed = (result.parsed ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = { optimisation_status: "needs_review" };
    const applied: string[] = [];

    const text = (key: string) =>
      typeof parsed[key] === "string" && parsed[key] ? String(parsed[key]).trim() : null;

    for (const key of [
      "target_query",
      "search_intent",
      "meta_title",
      "meta_description",
      "schema_type",
    ] as const) {
      const value = text(key);
      if (value) {
        patch[key] = value;
        applied.push(key);
      }
    }

    if (Array.isArray(parsed["secondary_queries"])) {
      const queries = (parsed["secondary_queries"] as unknown[])
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim())
        .slice(0, 6);
      if (queries.length > 0) {
        patch["secondary_queries"] = queries;
        applied.push("secondary_queries");
      }
    }

    patch["last_reviewed_at"] = null;

    const { error: updateError } = await supabase
      .from("seo_records")
      .update(patch)
      .eq("id", input.recordId);
    if (updateError) throw new Error(updateError.message);

    let questionsAdded = 0;
    if (Array.isArray(parsed["questions"])) {
      const { data: existing } = await supabase
        .from("seo_questions")
        .select("question")
        .eq("seo_record_id", input.recordId);
      const known = new Set((existing ?? []).map((row) => row.question.trim().toLowerCase()));

      const rows = (parsed["questions"] as Array<Record<string, unknown>>)
        .filter((item) => typeof item["question"] === "string" && String(item["question"]).trim())
        .map((item) => ({
          seo_record_id: input.recordId,
          question: String(item["question"]).trim(),
          answer: typeof item["answer"] === "string" ? String(item["answer"]).trim() : null,
          include_in_faq_schema: false,
        }))
        .filter((row) => !known.has(row.question.toLowerCase()))
        .slice(0, 6);

      if (rows.length > 0) {
        const { error } = await supabase.from("seo_questions").insert(rows);
        if (error) throw new Error(error.message);
        questionsAdded = rows.length;
      }
    }

    await supabase
      .from("ai_generation_runs")
      .update({
        status: "succeeded",
        completed_at: new Date().toISOString(),
        provider: result.provider,
        model: result.model,
        token_input: result.tokenInput ?? null,
        token_output: result.tokenOutput ?? null,
        output: parsed as never,
      })
      .eq("id", run.id);

    return { runId: run.id, applied, questionsAdded };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Planning failed";
    await supabase
      .from("ai_generation_runs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error_message: message,
      })
      .eq("id", run.id);
    throw new Error(message);
  }
}
