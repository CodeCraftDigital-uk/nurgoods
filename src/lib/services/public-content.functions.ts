import { createServerFn } from "@tanstack/react-start";

/**
 * Public, read only content reads for customer facing surfaces.
 *
 * These run through the publishable key so server rendering never needs a
 * session. Row level security limits every read to content that has been
 * approved and published by a person.
 */

export interface PublicArticleSummary {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  hero_image_url: string | null;
  hero_image_alt: string | null;
  meta_description: string | null;
  tags: string[] | null;
  author_name: string | null;
  reading_minutes: number | null;
  published_at: string | null;
}

export interface PublicArticleSource {
  id: string;
  url: string;
  title: string | null;
  publisher: string | null;
  author: string | null;
  published_date: string | null;
  verified: boolean;
}

export interface PublicArticleLink {
  id: string;
  anchor_text: string;
  target_type: string;
  target_reference: string;
}

export interface PublicArticle extends PublicArticleSummary {
  body_markdown: string | null;
  meta_title: string | null;
  canonical_url: string | null;
  schema_type: string | null;
  faqs: unknown;
  sources_verified: boolean;
  updated_at: string;
  sources: PublicArticleSource[];
  links: PublicArticleLink[];
}

export interface PublicLegalDocument {
  id: string;
  doc_key: string;
  slug: string;
  title: string;
  summary: string | null;
  body_markdown: string;
  effective_date: string | null;
  version: number;
  updated_at: string;
}

export interface PublicPlacement {
  surface: string;
  placement_key: string;
  label: string;
  description: string | null;
  widget_reference: string | null;
}

const ARTICLE_SUMMARY_COLUMNS =
  "id, slug, title, excerpt, hero_image_url, hero_image_alt, meta_description, tags, author_name, reading_minutes, published_at";

async function publicClient() {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env["SUPABASE_URL"]!;
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  return createClient(url, key, {
    auth: { persistSession: false },
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
}

/** Published Journal articles, newest first. */
export const listPublicArticles = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicArticleSummary[]> => {
    const supabase = await publicClient();
    const { data, error } = await supabase
      .from("articles")
      .select(ARTICLE_SUMMARY_COLUMNS)
      .eq("status", "published")
      .not("published_at", "is", null)
      .order("published_at", { ascending: false })
      .limit(60);
    if (error) throw new Error(error.message);
    return (data ?? []) as PublicArticleSummary[];
  },
);

/** A single published article with its citations and accepted internal links. */
export const getPublicArticle = createServerFn({ method: "GET" })
  .inputValidator((input: { slug: string }) => ({ slug: String(input.slug) }))
  .handler(async ({ data }): Promise<PublicArticle | null> => {
    const supabase = await publicClient();
    const { data: article, error } = await supabase
      .from("articles")
      .select(
        `${ARTICLE_SUMMARY_COLUMNS}, body_markdown, meta_title, canonical_url, schema_type, faqs, sources_verified, updated_at`,
      )
      .eq("slug", data.slug)
      .eq("status", "published")
      .not("published_at", "is", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!article) return null;

    const [sources, links] = await Promise.all([
      supabase
        .from("article_sources")
        .select("id, url, title, publisher, author, published_date, verified")
        .eq("article_id", (article as { id: string }).id)
        .order("created_at", { ascending: true }),
      supabase
        .from("article_internal_links")
        .select("id, anchor_text, target_type, target_reference")
        .eq("article_id", (article as { id: string }).id)
        .eq("accepted", true),
    ]);

    return {
      ...(article as PublicArticleSummary & Record<string, never>),
      sources: (sources.data ?? []) as PublicArticleSource[],
      links: (links.data ?? []) as PublicArticleLink[],
    } as PublicArticle;
  });

/** Published, owner approved policy documents. Placeholders never appear. */
export const listPublicLegalDocuments = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicLegalDocument[]> => {
    const supabase = await publicClient();
    const { data, error } = await supabase
      .from("legal_documents")
      .select("id, doc_key, slug, title, summary, body_markdown, effective_date, version, updated_at")
      .eq("status", "published")
      .eq("is_placeholder", false);
    if (error) throw new Error(error.message);
    return (data ?? []) as PublicLegalDocument[];
  },
);

export const getPublicLegalDocument = createServerFn({ method: "GET" })
  .inputValidator((input: { slug: string }) => ({ slug: String(input.slug) }))
  .handler(async ({ data }): Promise<PublicLegalDocument | null> => {
    const supabase = await publicClient();
    const { data: doc, error } = await supabase
      .from("legal_documents")
      .select("id, doc_key, slug, title, summary, body_markdown, effective_date, version, updated_at")
      .eq("slug", data.slug)
      .eq("status", "published")
      .eq("is_placeholder", false)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (doc ?? null) as PublicLegalDocument | null;
  });

/** Enabled review widget placements, used to render the right slot per surface. */
export const listPublicPlacements = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicPlacement[]> => {
    const supabase = await publicClient();
    const { data, error } = await supabase
      .from("review_placements")
      .select("surface, placement_key, label, description, widget_reference")
      .eq("enabled", true);
    if (error) throw new Error(error.message);
    return (data ?? []) as PublicPlacement[];
  },
);
