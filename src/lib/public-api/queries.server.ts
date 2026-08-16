/**
 * Read only query layer behind the public connector surface.
 *
 * Every read here runs through the publishable key, so row level security is
 * the security boundary and the service key is never involved. The queries
 * project explicit safe columns only. Raw store payloads, internal notes,
 * prompts, run logs, credentials and unpublished content are never selected.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonical, PAGE_LIMITS, type PublicPage } from "./contract";

type AnyClient = SupabaseClient<any, any, any>;

function runtimeEnv(name: string): string | undefined {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  return runtime.process?.env?.[name]?.trim() || undefined;
}

let cached: AnyClient | null = null;

/** Publishable key client. Created lazily so module import never reads env. */
export async function publicClient(): Promise<AnyClient> {
  if (cached) return cached;
  const { createClient } = await import("@supabase/supabase-js");
  const url = runtimeEnv("SUPABASE_URL") ?? runtimeEnv("VITE_SUPABASE_URL");
  const key =
    runtimeEnv("SUPABASE_PUBLISHABLE_KEY") ??
    runtimeEnv("VITE_SUPABASE_PUBLISHABLE_KEY") ??
    runtimeEnv("SUPABASE_ANON_KEY");
  if (!url || !key) throw new Error("Public data access is not configured");
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
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
  return cached;
}

export interface PageInput {
  limit?: number | undefined;
  offset?: number | undefined;
}

export function normalisePage(input: PageInput): { limit: number; offset: number } {
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? PAGE_LIMITS.default), 1), PAGE_LIMITS.max);
  const offset = Math.max(Math.trunc(input.offset ?? 0), 0);
  return { limit, offset };
}

function pageMeta(rows: unknown[], limit: number, offset: number): PublicPage {
  return { limit, offset, count: rows.length, has_more: rows.length === limit };
}

/** Escapes a user query for a PostgREST or/ilike filter. */
function safeTerm(term: string): string {
  return term.replace(/[%,()*\\]/g, " ").trim();
}

/* --------------------------------- products -------------------------------- */

const PRODUCT_COLUMNS =
  "id, shopify_product_id, handle, title, product_type, vendor, tags, featured_image_url, price_min, price_max, currency, variant_count, shopify_updated_at, last_synced_at";

export interface PublicProduct {
  id: string;
  handle: string;
  title: string;
  product_type: string | null;
  vendor: string | null;
  tags: string[];
  image_url: string | null;
  price: { min: number | null; max: number | null; currency: string | null };
  variant_count: number;
  canonical_url: string;
  last_updated_at: string | null;
  provenance: "store_sync";
  summary?: string | null;
}

function mapProduct(row: any, summary?: string | null): PublicProduct {
  return {
    id: String(row.shopify_product_id ?? row.id),
    handle: row.handle,
    title: row.title,
    product_type: row.product_type ?? null,
    vendor: row.vendor ?? null,
    tags: row.tags ?? [],
    image_url: row.featured_image_url ?? null,
    price: {
      min: row.price_min ?? null,
      max: row.price_max ?? null,
      currency: row.currency ?? null,
    },
    variant_count: row.variant_count ?? 0,
    canonical_url: canonical.product(row.handle),
    last_updated_at: row.shopify_updated_at ?? row.last_synced_at ?? null,
    provenance: "store_sync",
    ...(summary === undefined ? {} : { summary }),
  };
}

export async function searchProducts(input: {
  query?: string | undefined;
  productType?: string | undefined;
  tag?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}): Promise<{ items: PublicProduct[]; page: PublicPage }> {
  const supabase = await publicClient();
  const { limit, offset } = normalisePage(input);
  let builder = supabase
    .from("shopify_products")
    .select(PRODUCT_COLUMNS)
    .order("title", { ascending: true })
    .range(offset, offset + limit - 1);

  const term = input.query ? safeTerm(input.query) : "";
  if (term) {
    builder = builder.or(
      `title.ilike.%${term}%,product_type.ilike.%${term}%,vendor.ilike.%${term}%`,
    );
  }
  if (input.productType) builder = builder.eq("product_type", input.productType);
  if (input.tag) builder = builder.contains("tags", [input.tag]);

  // Suppressed duplicate listings never appear in public or assistant results.
  const { data: hidden } = await supabase
    .from("duplicate_group_members")
    .select("product_id")
    .eq("suppressed", true)
    .limit(5000);
  const hiddenIds = ((hidden ?? []) as any[]).map((row) => row.product_id as string);
  if (hiddenIds.length > 0) builder = builder.not("id", "in", `(${hiddenIds.join(",")})`);

  const { data, error } = await builder;
  if (error) throw new Error(error.message);
  const items = (data ?? []).map((row) => mapProduct(row as any));
  return { items, page: pageMeta(items, limit, offset) };
}

export interface PublicProductDetail extends PublicProduct {
  long_description: string | null;
  benefits: string[];
  use_cases: string[];
  specifications: { label: string; value: string }[];
  delivery_information: string | null;
  care_information: string | null;
  faqs: { question: string; answer: string }[];
  content_last_updated_at: string | null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function specList(value: unknown): { label: string; value: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const entry = item as { label?: unknown; value?: unknown };
    if (typeof entry.label !== "string" || typeof entry.value !== "string") return [];
    return [{ label: entry.label, value: entry.value }];
  });
}

function faqList(value: unknown): { question: string; answer: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const entry = item as { question?: unknown; answer?: unknown };
    if (typeof entry.question !== "string" || typeof entry.answer !== "string") return [];
    return [{ question: entry.question, answer: entry.answer }];
  });
}

export async function getProduct(handle: string): Promise<PublicProductDetail | null> {
  const supabase = await publicClient();
  const { data, error } = await supabase
    .from("shopify_products")
    .select(PRODUCT_COLUMNS)
    .eq("handle", handle)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  // A suppressed duplicate resolves to the listing customers actually see, so
  // assistants and public API callers only ever receive the canonical record.
  const { data: member } = await supabase
    .from("duplicate_group_members")
    .select("suppressed, group_id")
    .eq("product_id", (data as any).id)
    .maybeSingle();
  if (member && (member as any).suppressed) {
    const { data: group } = await supabase
      .from("duplicate_groups")
      .select("canonical_handle")
      .eq("id", (member as any).group_id)
      .maybeSingle();
    const canonicalHandle = (group as any)?.canonical_handle as string | null | undefined;
    if (canonicalHandle && canonicalHandle !== handle) return getProduct(canonicalHandle);
    return null;
  }


  const row = data as any;
  const { data: enrichment } = await supabase
    .from("product_enrichment")
    .select(
      "summary, long_description, benefits, use_cases, specifications, delivery_information, care_information, faqs, updated_at",
    )
    .eq("product_id", row.id)
    .maybeSingle();

  const content = (enrichment ?? {}) as any;
  return {
    ...mapProduct(row, content.summary ?? null),
    long_description: content.long_description ?? null,
    benefits: stringList(content.benefits),
    use_cases: stringList(content.use_cases),
    specifications: specList(content.specifications),
    delivery_information: content.delivery_information ?? null,
    care_information: content.care_information ?? null,
    faqs: faqList(content.faqs),
    content_last_updated_at: content.updated_at ?? null,
  };
}

/* -------------------------------- categories ------------------------------- */

export interface PublicCollection {
  id: string;
  handle: string;
  title: string;
  description: string | null;
  image_url: string | null;
  product_count: number;
  canonical_url: string;
  last_updated_at: string | null;
  provenance: "store_sync";
}

export async function searchCollections(input: {
  query?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}): Promise<{ items: PublicCollection[]; page: PublicPage }> {
  const supabase = await publicClient();
  const { limit, offset } = normalisePage(input);
  let builder = supabase
    .from("shopify_collections")
    .select(
      "id, shopify_collection_id, handle, title, description, image_url, product_count, shopify_updated_at, last_synced_at",
    )
    .order("title", { ascending: true })
    .range(offset, offset + limit - 1);
  const term = input.query ? safeTerm(input.query) : "";
  if (term) builder = builder.ilike("title", `%${term}%`);

  const { data, error } = await builder;
  if (error) throw new Error(error.message);
  const items = (data ?? []).map((raw) => {
    const row = raw as any;
    return {
      id: String(row.shopify_collection_id ?? row.id),
      handle: row.handle,
      title: row.title,
      description: row.description ?? null,
      image_url: row.image_url ?? null,
      product_count: row.product_count ?? 0,
      canonical_url: canonical.collection(row.handle),
      last_updated_at: row.shopify_updated_at ?? row.last_synced_at ?? null,
      provenance: "store_sync" as const,
    };
  });
  return { items, page: pageMeta(items, limit, offset) };
}

/* --------------------------------- journal --------------------------------- */

export interface PublicArticleCard {
  slug: string;
  title: string;
  excerpt: string | null;
  description: string | null;
  tags: string[];
  author: string | null;
  reading_minutes: number | null;
  published_at: string | null;
  canonical_url: string;
  provenance: "editorial_published";
}

const ARTICLE_CARD_COLUMNS =
  "slug, title, excerpt, meta_description, tags, author_name, reading_minutes, published_at";

function mapArticle(raw: any): PublicArticleCard {
  return {
    slug: raw.slug,
    title: raw.title,
    excerpt: raw.excerpt ?? null,
    description: raw.meta_description ?? null,
    tags: raw.tags ?? [],
    author: raw.author_name ?? null,
    reading_minutes: raw.reading_minutes ?? null,
    published_at: raw.published_at ?? null,
    canonical_url: canonical.article(raw.slug),
    provenance: "editorial_published",
  };
}

export async function searchArticles(input: {
  query?: string | undefined;
  tag?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}): Promise<{ items: PublicArticleCard[]; page: PublicPage }> {
  const supabase = await publicClient();
  const { limit, offset } = normalisePage(input);
  let builder = supabase
    .from("articles")
    .select(ARTICLE_CARD_COLUMNS)
    .eq("status", "published")
    .not("published_at", "is", null)
    .order("published_at", { ascending: false })
    .range(offset, offset + limit - 1);
  const term = input.query ? safeTerm(input.query) : "";
  if (term) builder = builder.or(`title.ilike.%${term}%,excerpt.ilike.%${term}%`);
  if (input.tag) builder = builder.contains("tags", [input.tag]);

  const { data, error } = await builder;
  if (error) throw new Error(error.message);
  const items = (data ?? []).map((row) => mapArticle(row as any));
  return { items, page: pageMeta(items, limit, offset) };
}

export interface PublicArticleFull extends PublicArticleCard {
  body_markdown: string | null;
  faqs: { question: string; answer: string }[];
  updated_at: string;
  sources: { url: string; title: string | null; publisher: string | null }[];
}

export async function getArticle(slug: string): Promise<PublicArticleFull | null> {
  const supabase = await publicClient();
  const { data, error } = await supabase
    .from("articles")
    .select(`id, ${ARTICLE_CARD_COLUMNS}, body_markdown, faqs, updated_at`)
    .eq("slug", slug)
    .eq("status", "published")
    .not("published_at", "is", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as any;

  const { data: sources } = await supabase
    .from("article_sources")
    .select("url, title, publisher, verified")
    .eq("article_id", row.id)
    .eq("verified", true);

  return {
    ...mapArticle(row),
    body_markdown: row.body_markdown ?? null,
    faqs: faqList(row.faqs),
    updated_at: row.updated_at,
    sources: ((sources ?? []) as any[]).map((s) => ({
      url: s.url,
      title: s.title ?? null,
      publisher: s.publisher ?? null,
    })),
  };
}

/* ------------------------------ store knowledge ----------------------------- */

export interface PublicPolicySummary {
  key: string;
  slug: string;
  title: string;
  summary: string | null;
  effective_date: string | null;
  version: number;
  canonical_url: string;
  updated_at: string;
}

export async function listPolicies(): Promise<PublicPolicySummary[]> {
  const supabase = await publicClient();
  const { data, error } = await supabase
    .from("legal_documents")
    .select("doc_key, slug, title, summary, effective_date, version, updated_at")
    .eq("status", "published")
    .eq("is_placeholder", false)
    .order("doc_key", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map((row) => ({
    key: row.doc_key,
    slug: row.slug,
    title: row.title,
    summary: row.summary ?? null,
    effective_date: row.effective_date ?? null,
    version: row.version,
    canonical_url: canonical.legal(row.slug),
    updated_at: row.updated_at,
  }));
}

export interface PublicPolicyDocument extends PublicPolicySummary {
  body_markdown: string;
}

export async function getPolicy(slug: string): Promise<PublicPolicyDocument | null> {
  const supabase = await publicClient();
  const { data, error } = await supabase
    .from("legal_documents")
    .select("doc_key, slug, title, summary, body_markdown, effective_date, version, updated_at")
    .eq("slug", slug)
    .eq("status", "published")
    .eq("is_placeholder", false)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as any;
  return {
    key: row.doc_key,
    slug: row.slug,
    title: row.title,
    summary: row.summary ?? null,
    body_markdown: row.body_markdown,
    effective_date: row.effective_date ?? null,
    version: row.version,
    canonical_url: canonical.legal(row.slug),
    updated_at: row.updated_at,
  };
}

/* --------------------------------- answers --------------------------------- */

export interface PublicAnswer {
  question: string;
  answer: string;
  topic: string | null;
  topic_type: string | null;
  canonical_url: string | null;
  updated_at: string;
}

export async function listAnswers(input: {
  query?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}): Promise<{ items: PublicAnswer[]; page: PublicPage }> {
  const supabase = await publicClient();
  const { limit, offset } = normalisePage(input);
  let builder = supabase
    .from("seo_questions")
    .select("question, answer, updated_at, seo_record_id")
    .eq("include_in_faq_schema", true)
    .not("answer", "is", null)
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit - 1);
  const term = input.query ? safeTerm(input.query) : "";
  if (term) builder = builder.ilike("question", `%${term}%`);

  const { data, error } = await builder;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as any[];
  const recordIds = [...new Set(rows.map((r) => r.seo_record_id))];
  const records = recordIds.length
    ? ((
        await supabase
          .from("seo_records")
          .select("id, target_type, target_reference, target_label")
          .in("id", recordIds)
      ).data ?? [])
    : [];
  const byId = new Map(
    (records as any[]).map((r) => [r.id as string, r]),
  );

  const items = rows.map((row) => {
    const record = byId.get(row.seo_record_id);
    const type = record?.target_type ?? null;
    const reference = record?.target_reference ?? null;
    let url: string | null = null;
    if (reference && type === "product") url = canonical.product(reference);
    if (reference && type === "collection") url = canonical.collection(reference);
    if (reference && type === "article") url = canonical.article(reference);
    return {
      question: row.question,
      answer: row.answer as string,
      topic: record?.target_label ?? reference ?? null,
      topic_type: type,
      canonical_url: url,
      updated_at: row.updated_at,
    };
  });
  return { items, page: pageMeta(items, limit, offset) };
}

/* -------------------------------- readiness -------------------------------- */

export interface ConnectorDataCounts {
  products: number;
  collections: number;
  articles: number;
  policies: number;
  answers: number;
  lastStoreSyncAt: string | null;
}

/** Counts only public rows, so it is safe to expose in the status endpoint. */
export async function connectorDataCounts(): Promise<ConnectorDataCounts> {
  const supabase = await publicClient();
  const head = { count: "exact" as const, head: true };
  const [products, collections, articles, policies, answers, latest] = await Promise.all([
    supabase.from("shopify_products").select("id", head),
    supabase.from("shopify_collections").select("id", head),
    supabase
      .from("articles")
      .select("id", head)
      .eq("status", "published")
      .not("published_at", "is", null),
    supabase
      .from("legal_documents")
      .select("id", head)
      .eq("status", "published")
      .eq("is_placeholder", false),
    supabase.from("seo_questions").select("id", head).eq("include_in_faq_schema", true),
    supabase
      .from("shopify_products")
      .select("last_synced_at")
      .order("last_synced_at", { ascending: false })
      .limit(1),
  ]);

  return {
    products: products.count ?? 0,
    collections: collections.count ?? 0,
    articles: articles.count ?? 0,
    policies: policies.count ?? 0,
    answers: answers.count ?? 0,
    lastStoreSyncAt:
      ((latest.data ?? [])[0] as any)?.last_synced_at ?? null,
  };
}
