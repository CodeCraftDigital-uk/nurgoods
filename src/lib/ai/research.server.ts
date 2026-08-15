import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResearchQuery, ResearchSource } from "./provider";

/**
 * Server side research runtime.
 *
 * Credentials are read from server environment secrets and never leave this
 * module. Research only ever writes unverified source records. Nothing is
 * written into an article body, nothing is approved and nothing is published.
 * A person verifies each source before it can support a claim.
 */

export interface ResearchAdapter {
  readonly id: string;
  search(query: ResearchQuery): Promise<ResearchSource[]>;
}

export interface ResearchProviderConfig {
  configured: boolean;
  providerId: string | null;
  missing: string[];
}

const SUPPORTED_PROVIDERS = ["tavily", "brave"] as const;

export function readResearchConfig(): ResearchProviderConfig {
  const providerId = process.env["RESEARCH_PROVIDER_ID"]?.trim() || null;
  const apiKey = process.env["RESEARCH_PROVIDER_API_KEY"]?.trim() || null;
  const missing: string[] = [];
  if (!apiKey) missing.push("RESEARCH_PROVIDER_API_KEY");
  return { configured: missing.length === 0, providerId, missing };
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}\u2026` : value;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Resolves the configured research adapter, or throws a clear operator error. */
export function resolveResearchAdapter(): ResearchAdapter {
  const apiKey = process.env["RESEARCH_PROVIDER_API_KEY"]?.trim();
  if (!apiKey) {
    throw new Error(
      "Research is not configured. Add RESEARCH_PROVIDER_API_KEY as a server secret before running this stage.",
    );
  }
  const providerId = (process.env["RESEARCH_PROVIDER_ID"]?.trim() || "tavily").toLowerCase();
  if (!SUPPORTED_PROVIDERS.includes(providerId as (typeof SUPPORTED_PROVIDERS)[number])) {
    throw new Error(
      `Unknown research provider "${providerId}". Set RESEARCH_PROVIDER_ID to one of: ${SUPPORTED_PROVIDERS.join(", ")}.`,
    );
  }

  if (providerId === "brave") {
    return {
      id: "brave",
      async search(query) {
        const url = new URL("https://api.search.brave.com/res/v1/web/search");
        url.searchParams.set("q", query.query);
        url.searchParams.set("count", String(Math.min(query.maxResults ?? 8, 20)));
        if (query.freshnessDays && query.freshnessDays <= 365) {
          url.searchParams.set("freshness", query.freshnessDays <= 7 ? "pw" : "py");
        }
        const response = await fetch(url, {
          headers: { accept: "application/json", "x-subscription-token": apiKey },
        });
        if (!response.ok) {
          throw new Error(`Research provider responded with ${response.status}`);
        }
        const payload = (await response.json()) as {
          web?: { results?: Array<Record<string, unknown>> };
        };
        return (payload.web?.results ?? [])
          .filter((item) => typeof item["url"] === "string")
          .map((item) => {
            const source: ResearchSource = { url: String(item["url"]) };
            if (typeof item["title"] === "string") source.title = String(item["title"]);
            if (typeof item["description"] === "string") {
              source.excerpt = truncate(String(item["description"]), 600);
            }
            if (typeof item["age"] === "string") source.publishedDate = String(item["age"]);
            const host = hostOf(source.url);
            if (host) source.publisher = host;
            return source;
          });
      },
    };
  }

  return {
    id: "tavily",
    async search(query) {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query: query.query,
          max_results: Math.min(query.maxResults ?? 8, 20),
          search_depth: "advanced",
          ...(query.freshnessDays ? { days: query.freshnessDays } : {}),
        }),
      });
      if (!response.ok) {
        throw new Error(`Research provider responded with ${response.status}`);
      }
      const payload = (await response.json()) as {
        results?: Array<Record<string, unknown>>;
      };
      return (payload.results ?? [])
        .filter((item) => typeof item["url"] === "string")
        .map((item) => {
          const source: ResearchSource = { url: String(item["url"]) };
          if (typeof item["title"] === "string") source.title = String(item["title"]);
          if (typeof item["content"] === "string") {
            source.excerpt = truncate(String(item["content"]), 600);
          }
          if (typeof item["published_date"] === "string") {
            source.publishedDate = String(item["published_date"]);
          }
          const host = hostOf(source.url);
          if (host) source.publisher = host;
          return source;
        });
    },
  };
}

export interface ResearchRunResult {
  runId: string;
  query: string;
  provider: string;
  found: number;
  added: number;
  skipped: number;
}

/**
 * Runs the research stage for an article. Every attempt is recorded in the
 * generation run audit trail, including failures, so an operator can see what
 * was searched and what came back.
 */
export async function runResearch(
  supabase: SupabaseClient<any, "public", any>,
  input: { articleId: string; userId: string; query?: string; freshnessDays?: number },
): Promise<ResearchRunResult> {
  const { data: article, error: articleError } = await supabase
    .from("articles")
    .select("id,title,brief_id")
    .eq("id", input.articleId)
    .single();
  if (articleError || !article) throw new Error("Article not found");

  const { data: brief } = article.brief_id
    ? await supabase
        .from("article_briefs")
        .select("target_query,topic,search_intent")
        .eq("id", article.brief_id)
        .maybeSingle()
    : { data: null };

  const query = (
    input.query?.trim() ||
    brief?.target_query ||
    brief?.topic ||
    article.title ||
    ""
  ).trim();
  if (!query) {
    throw new Error("Add a search query, a brief target query or an article title before running research.");
  }

  const { data: run, error: runError } = await supabase
    .from("ai_generation_runs")
    .insert({
      stage: "research",
      entity_type: "article",
      entity_id: input.articleId,
      status: "running",
      started_at: new Date().toISOString(),
      created_by: input.userId,
      input: { query, freshnessDays: input.freshnessDays ?? null },
    })
    .select("id")
    .single();
  if (runError || !run) throw new Error(runError?.message ?? "Could not record the research run");

  try {
    const adapter = resolveResearchAdapter();
    const results = await adapter.search({
      query,
      maxResults: 8,
      ...(input.freshnessDays ? { freshnessDays: input.freshnessDays } : {}),
    });

    const { data: existing } = await supabase
      .from("article_sources")
      .select("url")
      .eq("article_id", input.articleId);
    const known = new Set((existing ?? []).map((row: { url: string }) => row.url));

    const rows = results
      .filter((source) => !known.has(source.url))
      .map((source) => ({
        article_id: input.articleId,
        url: source.url,
        title: source.title ?? null,
        publisher: source.publisher ?? null,
        published_date: source.publishedDate ?? null,
        excerpt: source.excerpt ?? null,
        verified: false,
        verification_notes: `Retrieved by research provider ${adapter.id}. Awaiting human verification.`,
      }));

    if (rows.length > 0) {
      const { error } = await supabase.from("article_sources").insert(rows);
      if (error) throw new Error(error.message);
    }

    await supabase
      .from("ai_generation_runs")
      .update({
        status: "succeeded",
        completed_at: new Date().toISOString(),
        provider: adapter.id,
        output: {
          query,
          found: results.length,
          added: rows.length,
          urls: results.map((source) => source.url),
        } as never,
      })
      .eq("id", run.id);

    return {
      runId: run.id,
      query,
      provider: adapter.id,
      found: results.length,
      added: rows.length,
      skipped: results.length - rows.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Research failed";
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
