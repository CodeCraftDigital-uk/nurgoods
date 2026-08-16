import type { SupabaseClient } from "@supabase/supabase-js";
import { streamText } from "ai";
import type { AiCompletionRequest, AiCompletionResult, AiProviderAdapter } from "./provider";
import type { WorkflowStage } from "@/lib/types/platform";
import { EDITORIAL_MODEL, createManagedAiProvider, readManagedAiKey } from "./gateway.server";

/**
 * Server side runtime for the editorial workflow.
 *
 * Generation runs on the platform managed AI service. The owner does not
 * supply model credentials and nothing model related is ever sent to the
 * browser.
 */

/** Adapter over the managed AI service. */
export function resolveAdapter(): AiProviderAdapter {
  const apiKey = readManagedAiKey();
  if (!apiKey) {
    throw new Error("Managed AI is unavailable for this workspace right now. Try again shortly.");
  }
  const provider = createManagedAiProvider(apiKey);
  const model = EDITORIAL_MODEL;

  return {
    id: "managed",
    label: "Managed AI",
    async complete(request: AiCompletionRequest): Promise<AiCompletionResult> {
      // The model runtime expects system guidance as a dedicated field rather
      // than a message role, so brand rules are lifted out of the message list.
      const systemText = request.messages
        .filter((message) => message.role === "system")
        .map((message) => message.content)
        .join("\n\n")
        .trim();
      const conversation = request.messages.filter((message) => message.role !== "system");

      const stream = streamText({
        model: provider(model),
        ...(systemText ? { system: systemText } : {}),
        messages: conversation,
        temperature: request.temperature ?? 0.4,
        maxOutputTokens: request.maxOutputTokens ?? 4000,
      });


      const text = (await stream.text)?.trim() ?? "";
      if (!text) throw new Error("The editorial model returned an empty response");

      const usage = await stream.usage;
      const result: AiCompletionResult = { provider: "managed", model, text };
      if (usage?.inputTokens != null) result.tokenInput = usage.inputTokens;
      if (usage?.outputTokens != null) result.tokenOutput = usage.outputTokens;

      if (request.responseSchema) {
        const parsed = extractJsonObject(text);
        if (parsed !== undefined) {
          result.parsed = parsed;
          return result;
        }

        // Some responses carry reasoning before the object or stop short of the
        // closing brace. One corrective pass recovers the stage instead of
        // failing the product.
        const retry = streamText({
          model: provider(model),
          ...(systemText ? { system: systemText } : {}),
          messages: [
            ...conversation,
            { role: "assistant" as const, content: text.slice(0, 2000) },
            {
              role: "user" as const,
              content:
                "That reply was not usable. Return the same result as a single raw JSON object only. No commentary, no reasoning, no code fences, and never stop before the closing brace.",
            },
          ],
          temperature: 0,
          maxOutputTokens: Math.max(request.maxOutputTokens ?? 4000, 6000),
        });
        const retryText = (await retry.text)?.trim() ?? "";
        const retryParsed = extractJsonObject(retryText);
        if (retryParsed === undefined) {
          throw new Error(
            `The editorial model did not return valid JSON for this stage. Response began: ${retryText.slice(0, 160)}`,
          );
        }
        result.parsed = retryParsed;
        result.text = retryText;
      }
      return result;
    },
  };
}

/**
 * Isolates the JSON object inside a model reply. Reasoning text, code fences
 * and trailing commentary are common, so every balanced candidate is tried,
 * largest first.
 */
function extractJsonObject(raw: string): unknown | undefined {
  const text = raw
    .replace(/^```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();

  const candidates: string[] = [];
  if (text.startsWith("{")) candidates.push(text);

  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const char = text[index]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          candidates.push(text.slice(start, index + 1));
          break;
        }
      }
    }
  }

  for (const candidate of candidates.sort((a, b) => b.length - a.length)) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === "object") return value;
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}


const BRAND_RULES = [
  "You write for NUR GOODS, a premium and calm retail brand. Tagline: Good things, brought to light.",
  "Never use em dashes.",
  "Never invent facts, sources, quotes, registrations, certifications or product claims.",
  "Only use the article body, brief and stored sources supplied to you.",
  "Return strict JSON only, with no commentary and no code fences.",
].join(" ");

const STAGE_INSTRUCTIONS: Record<string, { key: string; instruction: string }> = {
  draft: {
    key: "journal.draft",
    instruction:
      'Write or improve the article body in markdown against the brief. Return JSON {"body_markdown": string, "excerpt": string, "title": string}.',
  },
  optimisation: {
    key: "journal.optimisation",
    instruction:
      'Improve heading hierarchy, entity clarity and concise answerable sections without keyword stuffing or added claims. Return JSON {"body_markdown": string, "faqs": [{"question": string, "answer": string}]}.',
  },
  internal_links: {
    key: "journal.internal_links",
    instruction:
      'Suggest internal links using only the supplied product and collection handles. Return JSON {"links": [{"anchor_text": string, "target_type": "product"|"collection"|"article", "target_reference": string, "rationale": string}]}.',
  },
  metadata_schema: {
    key: "journal.metadata_schema",
    instruction:
      'Produce metadata. Meta title under 60 characters, meta description under 160 characters. Return JSON {"meta_title": string, "meta_description": string, "schema_type": string}.',
  },
};

export interface StageRunResult {
  stage: WorkflowStage;
  runId: string;
  applied: string[];
}

export async function runStage(
  supabase: SupabaseClient<any, "public", any>,
  input: { articleId: string; stage: WorkflowStage; userId: string },
): Promise<StageRunResult> {
  const config = STAGE_INSTRUCTIONS[input.stage];
  if (!config) {
    throw new Error(
      "This stage is handled by a person or by live research, so it cannot be generated here.",
    );
  }

  const { data: article, error: articleError } = await supabase
    .from("articles")
    .select("*")
    .eq("id", input.articleId)
    .single();
  if (articleError || !article) throw new Error("Article not found");

  const { data: brief } = article.brief_id
    ? await supabase.from("article_briefs").select("*").eq("id", article.brief_id).maybeSingle()
    : { data: null };

  const { data: sources } = await supabase
    .from("article_sources")
    .select("url,title,publisher,verified")
    .eq("article_id", input.articleId);

  const { data: promptVersion } = await supabase
    .from("prompt_versions")
    .select("id,template,version")
    .eq("stage", input.stage)
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const catalogue =
    input.stage === "internal_links"
      ? await supabase.from("shopify_products").select("handle,title").limit(50)
      : { data: null };
  const collections =
    input.stage === "internal_links"
      ? await supabase.from("shopify_collections").select("handle,title").limit(50)
      : { data: null };

  const context = {
    title: article.title,
    slug: article.slug,
    body_markdown: article.body_markdown,
    excerpt: article.excerpt,
    brief,
    sources: sources ?? [],
    products: catalogue.data ?? [],
    collections: collections.data ?? [],
  };

  const { data: run, error: runError } = await supabase
    .from("ai_generation_runs")
    .insert({
      stage: input.stage,
      entity_type: "article",
      entity_id: input.articleId,
      status: "running",
      started_at: new Date().toISOString(),
      created_by: input.userId,
      prompt_version_id: promptVersion?.id ?? null,
      input: { promptVersionKey: config.key, promptVersion: promptVersion?.version ?? null },
    })
    .select("id")
    .single();
  if (runError || !run) throw new Error(runError?.message ?? "Could not record the run");

  try {
    const adapter = resolveAdapter();
    const result = await adapter.complete({
      stage: input.stage,
      promptVersionKey: config.key,
      responseSchema: {},
      messages: [
        { role: "system", content: `${BRAND_RULES} ${promptVersion?.template ?? ""}`.trim() },
        { role: "user", content: `${config.instruction}\n\n${JSON.stringify(context)}` },
      ],
    });

    const parsed = (result.parsed ?? {}) as Record<string, unknown>;
    const applied: string[] = [];
    const patch: Record<string, unknown> = {};

    if (input.stage === "draft") {
      if (typeof parsed["body_markdown"] === "string") patch["body_markdown"] = parsed["body_markdown"];
      if (typeof parsed["excerpt"] === "string") patch["excerpt"] = parsed["excerpt"];
      if (typeof parsed["title"] === "string") patch["title"] = parsed["title"];
    } else if (input.stage === "optimisation") {
      if (typeof parsed["body_markdown"] === "string") patch["body_markdown"] = parsed["body_markdown"];
      if (Array.isArray(parsed["faqs"])) patch["faqs"] = parsed["faqs"];
    } else if (input.stage === "metadata_schema") {
      if (typeof parsed["meta_title"] === "string") patch["meta_title"] = parsed["meta_title"];
      if (typeof parsed["meta_description"] === "string") {
        patch["meta_description"] = parsed["meta_description"];
      }
      if (typeof parsed["schema_type"] === "string") patch["schema_type"] = parsed["schema_type"];
    }

    if (Object.keys(patch).length > 0) {
      const { error } = await supabase.from("articles").update(patch).eq("id", input.articleId);
      if (error) throw new Error(error.message);
      applied.push(...Object.keys(patch));
    }

    if (input.stage === "internal_links" && Array.isArray(parsed["links"])) {
      const rows = (parsed["links"] as Array<Record<string, unknown>>)
        .filter((link) => typeof link["anchor_text"] === "string")
        .map((link) => ({
          article_id: input.articleId,
          anchor_text: String(link["anchor_text"]),
          target_type: ["product", "collection", "article"].includes(String(link["target_type"]))
            ? (String(link["target_type"]) as "product" | "collection" | "article")
            : ("article" as const),
          target_reference: String(link["target_reference"] ?? ""),
          rationale: link["rationale"] ? String(link["rationale"]) : null,
        }));
      if (rows.length > 0) {
        const { error } = await supabase.from("article_internal_links").insert(rows);
        if (error) throw new Error(error.message);
        applied.push(`${rows.length} internal link suggestions`);
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

    return { stage: input.stage, runId: run.id, applied };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed";
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
