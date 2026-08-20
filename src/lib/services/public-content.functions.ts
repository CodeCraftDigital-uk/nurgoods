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

export interface PublicFaq {
  question: string;
  answer: string;
}

export interface PublicArticle extends PublicArticleSummary {
  body_markdown: string | null;
  meta_title: string | null;
  canonical_url: string | null;
  schema_type: string | null;
  faqs: PublicFaq[] | null;
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
  embed_snippet: string | null;
}

const ARTICLE_SUMMARY_COLUMNS =
  "id, slug, title, excerpt, hero_image_url, hero_image_alt, meta_description, tags, author_name, reading_minutes, published_at";

function keyedFetch(key: string) {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    // Pin the credential explicitly so no ambient request token (for example a
    // signed in visitor's bearer token) can ever be applied to these reads.
    headers.set("apikey", key);
    if (key.startsWith("sb_")) {
      // Current API keys are opaque strings, not bearer tokens. Sending one as
      // a bearer makes the API reject the request while trying to parse it.
      headers.delete("Authorization");
    } else {
      headers.set("Authorization", `Bearer ${key}`);
    }
    return fetch(input, { ...init, headers });
  };
}

async function publicClient() {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env["SUPABASE_URL"]!;
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  return createClient(url, key, {
    auth: { persistSession: false },
    global: { fetch: keyedFetch(key) },
  });
}

/** Service role reader used only for owner approved public policy content. */
async function adminClient() {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env["SUPABASE_URL"]!;
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"]!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: keyedFetch(key) },
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

    const record = article as unknown as Omit<PublicArticle, "sources" | "links" | "faqs"> & {
      faqs: unknown;
    };
    const faqs = Array.isArray(record.faqs)
      ? (record.faqs as unknown[]).flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const entry = item as { question?: unknown; answer?: unknown };
          if (typeof entry.question !== "string" || typeof entry.answer !== "string") return [];
          return [{ question: entry.question, answer: entry.answer }];
        })
      : [];

    return {
      ...record,
      faqs,
      sources: (sources.data ?? []) as PublicArticleSource[],
      links: (links.data ?? []) as PublicArticleLink[],
    };
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

/**
 * Enabled review widget placements. The embed snippet is admin authored
 * configuration meant for the public page, so returning it here is intended.
 */
export const listPublicPlacements = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicPlacement[]> => {
    const supabase = await publicClient();
    const { data, error } = await supabase
      .from("review_placements")
      .select("surface, placement_key, label, description, widget_reference, embed_snippet")
      .eq("enabled", true)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as PublicPlacement[];
  },
);

/* --------------------- store sourced legal documents --------------------- */

export interface PublicLegalSourceSummary {
  slug: string;
  title: string;
  summary: string | null;
  source_type: string;
  source_url: string | null;
  shopify_updated_at: string | null;
  last_synced_at: string;
  /** True when a person has approved a locally edited copy of this document. */
  locally_edited?: boolean;

}

export interface PublicLegalSource extends PublicLegalSourceSummary {
  body_html: string;
  shopify_published_at: string | null;
}

const LEGAL_SOURCE_COLUMNS =
  "slug, title, body_summary, source_type, source_url, shopify_updated_at, shopify_published_at, last_synced_at";

function toSummary(row: any): PublicLegalSourceSummary {
  return {
    slug: row.slug,
    title: row.title,
    summary: row.body_summary ?? null,
    source_type: row.source_type,
    source_url: row.source_url ?? null,
    shopify_updated_at: row.shopify_updated_at ?? null,
    last_synced_at: row.last_synced_at,
  };
}

/**
 * Policies that are safe to render in full on this site. A published local
 * copy always wins over the imported store wording, because it is the version
 * a person has reviewed and approved for customers.
 */
export const listPublicLegalSources = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicLegalSourceSummary[]> => {
    // Read with the publishable key so the published policy row set is
    // resolved by the same rules customers are subject to.
    const supabaseAdmin = await publicClient();
    const [sourcesResult, overridesResult] = await Promise.all([
      supabaseAdmin
        .from("shopify_legal_sources")
        .select(`id, ${LEGAL_SOURCE_COLUMNS}`)
        .eq("is_published", true)
        .order("title", { ascending: true }),
      supabaseAdmin
        .from("legal_source_overrides")
        .select("source_id, published_title, published_summary, published_at")
        .not("published_body_html", "is", null),
    ]);
    if (sourcesResult.error) throw new Error(sourcesResult.error.message);
    const overrides = new Map<string, any>(
      (overridesResult.data ?? []).map((row: any) => [row.source_id, row]),
    );

    const out: PublicLegalSourceSummary[] = [];
    for (const row of (sourcesResult.data ?? []) as any[]) {
      const override = overrides.get(row.id);
      if (override) {
        out.push({
          ...toSummary(row),
          title: override.published_title ?? row.title,
          summary: override.published_summary ?? row.body_summary ?? null,
          locally_edited: true,
        });
        continue;
      }
      if (row.public_visible === false) continue;
      out.push(toSummary(row));
    }
    return out.sort((a, b) => a.title.localeCompare(b.title));
  },
);

export const getPublicLegalSource = createServerFn({ method: "GET" })
  .inputValidator((input: { slug: string }) => ({ slug: String(input.slug) }))
  .handler(async ({ data }): Promise<PublicLegalSource | null> => {
    const supabaseAdmin = await publicClient();
    const { data: row, error } = await supabaseAdmin
      .from("shopify_legal_sources")
      .select(`id, ${LEGAL_SOURCE_COLUMNS}, body_html, public_visible`)
      .eq("slug", data.slug)
      .eq("is_published", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return null;

    const { data: override } = await supabaseAdmin
      .from("legal_source_overrides")
      .select("published_title, published_summary, published_body_html, published_at")
      .eq("source_id", (row as any).id)
      .not("published_body_html", "is", null)
      .maybeSingle();

    const { sanitizeStoreHtml } = await import("@/lib/legal/sanitize");
    if (override) {
      return {
        ...toSummary(row),
        title: (override as any).published_title ?? (row as any).title,
        summary: (override as any).published_summary ?? (row as any).body_summary ?? null,
        locally_edited: true,
        shopify_published_at: (row as any).shopify_published_at ?? null,
        last_synced_at: (override as any).published_at ?? (row as any).last_synced_at,
        body_html: sanitizeStoreHtml((override as any).published_body_html ?? ""),
      };
    }
    if ((row as any).public_visible === false) return null;
    return {
      ...toSummary(row),
      shopify_published_at: (row as any).shopify_published_at ?? null,
      body_html: sanitizeStoreHtml((row as any).body_html ?? ""),
    };
  });


export interface PublicLegalReference {
  title: string;
  source_url: string;
}

/**
 * Published store policies that cannot be rendered here because their wording
 * still contains store template variables. Only the title and the canonical
 * store URL are returned so visitors are always sent to authoritative wording.
 */
export const listPublicLegalReferences = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicLegalReference[]> => {
    // A definer view returns only the policy name and its store link, so the
    // unrendered wording itself is never exposed to a public read.
    const supabase = await publicClient();
    const { data, error } = await supabase.rpc("public_legal_references" as never);
    if (error) return [];
    return ((data ?? []) as any[]).map((row) => ({
      title: row.title as string,
      source_url: row.source_url as string,
    }));
  },
);

/**
 * A single published store policy that must be read on the store because its
 * wording only resolves there. Never returns body text, only a safe pointer.
 */
export const getPublicLegalReference = createServerFn({ method: "GET" })
  .inputValidator((input: { slug: string }) => ({ slug: String(input.slug) }))
  .handler(async ({ data }): Promise<PublicLegalReference | null> => {
    const supabase = await publicClient();
    const { data: rows, error } = await supabase.rpc("public_legal_references" as never);
    const row = ((rows ?? []) as any[]).find((item) => item.slug === data.slug) ?? null;
    if (error || !row) return null;
    const url = (row as any).source_url;
    if (typeof url !== "string" || url.length === 0) return null;
    return { title: (row as any).title as string, source_url: url };
  });
