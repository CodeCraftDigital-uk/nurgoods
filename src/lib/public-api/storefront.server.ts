/**
 * Storefront read layer.
 *
 * These queries power the public customer facing pages. They run through the
 * publishable key, so row level security is the boundary: only active synced
 * store products, synced collections, published enrichment and approved
 * questions are ever visible. Nothing here fabricates price, stock, delivery
 * promises, ratings or product facts. Absent data stays absent.
 */
import { publicClient, normalisePage } from "./queries.server";

export type StorefrontSort = "featured" | "price_asc" | "price_desc" | "newest" | "title_desc";

export interface StorefrontProductCard {
  id: string;
  handle: string;
  title: string;
  product_type: string | null;
  vendor: string | null;
  tags: string[];
  image_url: string | null;
  price_min: number | null;
  price_max: number | null;
  currency: string | null;
  variant_count: number;
  summary: string | null;
  updated_at: string | null;
}

export interface StorefrontFacets {
  product_types: string[];
  total: number;
}

const CARD_COLUMNS =
  "id, handle, title, product_type, vendor, tags, featured_image_url, price_min, price_max, currency, variant_count, shopify_updated_at, last_synced_at";

function safeTerm(term: string): string {
  return term.replace(/[%,()*\\]/g, " ").trim().slice(0, 120);
}

function mapCard(row: any, summary: string | null = null): StorefrontProductCard {
  return {
    id: row.id,
    handle: row.handle,
    title: row.title,
    product_type: row.product_type ?? null,
    vendor: row.vendor ?? null,
    tags: row.tags ?? [],
    image_url: row.featured_image_url ?? null,
    price_min: row.price_min ?? null,
    price_max: row.price_max ?? null,
    currency: row.currency ?? null,
    variant_count: row.variant_count ?? 0,
    summary,
    updated_at: row.shopify_updated_at ?? row.last_synced_at ?? null,
  };
}

function applySort(builder: any, sort: StorefrontSort) {
  switch (sort) {
    case "price_asc":
      return builder.order("price_min", { ascending: true, nullsFirst: false });
    case "price_desc":
      return builder.order("price_max", { ascending: false, nullsFirst: false });
    case "newest":
      return builder.order("shopify_updated_at", { ascending: false, nullsFirst: false });
    case "title_desc":
      return builder.order("title", { ascending: false });
    default:
      return builder.order("title", { ascending: true });
  }
}

export async function listStorefrontProducts(input: {
  query?: string | undefined;
  productType?: string | undefined;
  collectionHandle?: string | undefined;
  sort?: StorefrontSort | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}): Promise<{ items: StorefrontProductCard[]; total: number; hasMore: boolean }> {
  const supabase = await publicClient();
  const { limit, offset } = normalisePage(input);

  let productIds: string[] | null = null;
  if (input.collectionHandle) {
    const { data: collection } = await supabase
      .from("shopify_collections")
      .select("id")
      .eq("handle", input.collectionHandle)
      .maybeSingle();
    if (!collection) return { items: [], total: 0, hasMore: false };
    const { data: joins } = await supabase
      .from("shopify_product_collections")
      .select("product_id")
      .eq("collection_id", (collection as any).id);
    productIds = ((joins ?? []) as any[]).map((row) => row.product_id);
    if (productIds.length === 0) return { items: [], total: 0, hasMore: false };
  }

  let builder = supabase
    .from("shopify_products")
    .select(CARD_COLUMNS, { count: "exact" })
    .range(offset, offset + limit - 1);
  builder = applySort(builder, input.sort ?? "featured");

  const term = input.query ? safeTerm(input.query) : "";
  if (term) {
    builder = builder.or(
      `title.ilike.%${term}%,product_type.ilike.%${term}%,vendor.ilike.%${term}%`,
    );
  }
  if (input.productType) builder = builder.eq("product_type", input.productType);
  if (productIds) builder = builder.in("id", productIds);

  const { data, error, count } = await builder;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as any[];

  let summaries = new Map<string, string>();
  if (rows.length > 0) {
    const { data: enrichment } = await supabase
      .from("product_enrichment")
      .select("product_id, summary")
      .in(
        "product_id",
        rows.map((row) => row.id),
      );
    summaries = new Map(
      ((enrichment ?? []) as any[])
        .filter((row) => typeof row.summary === "string" && row.summary.trim())
        .map((row) => [row.product_id as string, row.summary as string]),
    );
  }

  const items = rows.map((row) => mapCard(row, summaries.get(row.id) ?? null));
  const total = count ?? items.length;
  return { items, total, hasMore: offset + items.length < total };
}

export async function listStorefrontFacets(): Promise<StorefrontFacets> {
  const supabase = await publicClient();
  const { data, count, error } = await supabase
    .from("shopify_products")
    .select("product_type", { count: "exact" })
    .limit(500);
  if (error) throw new Error(error.message);
  const types = new Set<string>();
  for (const row of (data ?? []) as any[]) {
    if (typeof row.product_type === "string" && row.product_type.trim()) {
      types.add(row.product_type.trim());
    }
  }
  return { product_types: [...types].sort((a, b) => a.localeCompare(b)), total: count ?? 0 };
}

export interface StorefrontCollection {
  id: string;
  handle: string;
  title: string;
  description: string | null;
  image_url: string | null;
  product_count: number;
  updated_at: string | null;
}

function mapCollection(row: any): StorefrontCollection {
  return {
    id: row.id,
    handle: row.handle,
    title: row.title,
    description: row.description ?? null,
    image_url: row.image_url ?? null,
    product_count: row.product_count ?? 0,
    updated_at: row.shopify_updated_at ?? row.last_synced_at ?? null,
  };
}

export async function listStorefrontCollections(): Promise<StorefrontCollection[]> {
  const supabase = await publicClient();
  const { data, error } = await supabase
    .from("shopify_collections")
    .select("id, handle, title, description, image_url, product_count, shopify_updated_at, last_synced_at")
    .order("title", { ascending: true })
    .limit(100);
  if (error) throw new Error(error.message);
  return ((data ?? []) as any[]).map(mapCollection);
}

export async function getStorefrontCollection(handle: string): Promise<StorefrontCollection | null> {
  const supabase = await publicClient();
  const { data, error } = await supabase
    .from("shopify_collections")
    .select("id, handle, title, description, image_url, product_count, shopify_updated_at, last_synced_at")
    .eq("handle", handle)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapCollection(data) : null;
}

export interface StorefrontProductDetail extends StorefrontProductCard {
  long_description: string | null;
  benefits: string[];
  use_cases: string[];
  specifications: { label: string; value: string }[];
  delivery_information: string | null;
  care_information: string | null;
  faqs: { question: string; answer: string }[];
  content_updated_at: string | null;
  collections: { handle: string; title: string }[];
  related: StorefrontProductCard[];
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function pairList<K extends string, V extends string>(
  value: unknown,
  keyA: K,
  keyB: V,
): { [P in K | V]: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Record<string, unknown>;
    if (typeof entry[keyA] !== "string" || typeof entry[keyB] !== "string") return [];
    return [{ [keyA]: entry[keyA], [keyB]: entry[keyB] } as { [P in K | V]: string }];
  });
}

export async function getStorefrontProduct(handle: string): Promise<StorefrontProductDetail | null> {
  const supabase = await publicClient();
  const { data, error } = await supabase
    .from("shopify_products")
    .select(CARD_COLUMNS)
    .eq("handle", handle)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as any;

  const [{ data: enrichment }, { data: joins }, { data: seoRecord }] = await Promise.all([
    supabase
      .from("product_enrichment")
      .select(
        "summary, long_description, benefits, use_cases, specifications, delivery_information, care_information, faqs, updated_at",
      )
      .eq("product_id", row.id)
      .maybeSingle(),
    supabase
      .from("shopify_product_collections")
      .select("collection_id")
      .eq("product_id", row.id),
    supabase
      .from("seo_records")
      .select("id")
      .eq("target_type", "product")
      .eq("target_reference", handle)
      .maybeSingle(),
  ]);

  const content = (enrichment ?? {}) as any;

  const collectionIds = ((joins ?? []) as any[]).map((join) => join.collection_id);
  let collections: { handle: string; title: string }[] = [];
  if (collectionIds.length > 0) {
    const { data: rows } = await supabase
      .from("shopify_collections")
      .select("handle, title")
      .in("id", collectionIds);
    collections = ((rows ?? []) as any[]).map((c) => ({ handle: c.handle, title: c.title }));
  }

  // Approved questions only. Unapproved editorial questions never surface.
  let faqs = pairList(content.faqs, "question", "answer");
  if (faqs.length === 0 && seoRecord) {
    const { data: questions } = await supabase
      .from("seo_questions")
      .select("question, answer")
      .eq("seo_record_id", (seoRecord as any).id)
      .eq("include_in_faq_schema", true);
    faqs = ((questions ?? []) as any[])
      .filter((q) => typeof q.answer === "string" && q.answer.trim())
      .map((q) => ({ question: q.question as string, answer: q.answer as string }));
  }

  let related: StorefrontProductCard[] = [];
  if (row.product_type) {
    const { data: siblings } = await supabase
      .from("shopify_products")
      .select(CARD_COLUMNS)
      .eq("product_type", row.product_type)
      .neq("handle", handle)
      .order("title", { ascending: true })
      .limit(4);
    related = ((siblings ?? []) as any[]).map((sibling) => mapCard(sibling));
  }

  return {
    ...mapCard(row, content.summary ?? null),
    long_description: content.long_description ?? null,
    benefits: stringList(content.benefits),
    use_cases: stringList(content.use_cases),
    specifications: pairList(content.specifications, "label", "value"),
    delivery_information: content.delivery_information ?? null,
    care_information: content.care_information ?? null,
    faqs,
    content_updated_at: content.updated_at ?? null,
    collections,
    related,
  };
}
