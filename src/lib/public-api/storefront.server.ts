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
  compare_at_price_min: number | null;
  available_for_sale: boolean | null;
  summary: string | null;
  updated_at: string | null;
}

export interface StorefrontFacets {
  product_types: string[];
  tags: string[];
  total: number;
}

const CARD_COLUMNS =
  "id, handle, title, product_type, vendor, tags, featured_image_url, price_min, price_max, currency, compare_at_price_min, available_for_sale, variant_count, shopify_updated_at, last_synced_at";

const DETAIL_COLUMNS = `${CARD_COLUMNS}, description, description_html, seo_title, seo_description, online_store_url, options`;

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
    compare_at_price_min: row.compare_at_price_min ?? null,
    available_for_sale: row.available_for_sale ?? null,
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
  tag?: string | undefined;
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
      `title.ilike.%${term}%,product_type.ilike.%${term}%,vendor.ilike.%${term}%,description.ilike.%${term}%`,
    );
  }
  if (input.productType) builder = builder.eq("product_type", input.productType);
  if (input.tag) builder = builder.contains("tags", [input.tag]);
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
    .select("product_type, tags", { count: "exact" })
    .limit(1000);
  if (error) throw new Error(error.message);
  const types = new Set<string>();
  const tagCounts = new Map<string, number>();
  for (const row of (data ?? []) as any[]) {
    if (typeof row.product_type === "string" && row.product_type.trim()) {
      types.add(row.product_type.trim());
    }
    for (const tag of Array.isArray(row.tags) ? row.tags : []) {
      if (typeof tag !== "string" || !tag.trim()) continue;
      const key = tag.trim();
      tagCounts.set(key, (tagCounts.get(key) ?? 0) + 1);
    }
  }
  // Only tags that group more than one product are useful as a filter.
  const tags = [...tagCounts.entries()]
    .filter(([, hits]) => hits > 1)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 24)
    .map(([tag]) => tag);
  return {
    product_types: [...types].sort((a, b) => a.localeCompare(b)),
    tags,
    total: count ?? 0,
  };
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

export async function listStorefrontCollections(options?: {
  withProductsOnly?: boolean;
}): Promise<StorefrontCollection[]> {
  const supabase = await publicClient();
  const { data, error } = await supabase
    .from("shopify_collections")
    .select("id, handle, title, description, image_url, product_count, shopify_updated_at, last_synced_at")
    .order("title", { ascending: true })
    .limit(100);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  // The store does not always set a collection image, so a genuine member
  // product image stands in. Nothing is invented: the image always belongs to a
  // product inside that collection.
  const { data: joins } = await supabase
    .from("shopify_product_collections")
    .select("collection_id, product_id")
    .in(
      "collection_id",
      rows.map((row) => row.id),
    )
    .limit(2000);
  const joinRows = (joins ?? []) as any[];
  const productIds = [...new Set(joinRows.map((join) => join.product_id))];
  const imageByProduct = new Map<string, string>();
  if (productIds.length > 0) {
    const { data: products } = await supabase
      .from("shopify_products")
      .select("id, featured_image_url, title")
      .in("id", productIds);
    for (const product of (products ?? []) as any[]) {
      if (product.featured_image_url) imageByProduct.set(product.id, product.featured_image_url);
    }
  }
  const counts = new Map<string, number>();
  const covers = new Map<string, string>();
  for (const join of joinRows) {
    counts.set(join.collection_id, (counts.get(join.collection_id) ?? 0) + 1);
    const image = imageByProduct.get(join.product_id);
    if (image && !covers.has(join.collection_id)) covers.set(join.collection_id, image);
  }

  const mapped = rows.map((row) => {
    const collection = mapCollection(row);
    const count = counts.get(row.id) ?? collection.product_count;
    return {
      ...collection,
      product_count: count,
      image_url: collection.image_url ?? covers.get(row.id) ?? null,
    };
  });
  return options?.withProductsOnly ? mapped.filter((c) => c.product_count > 0) : mapped;
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

export interface StorefrontMedia {
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}

export interface StorefrontVariant {
  id: string;
  /** Numeric store variant identifier used to build a cart link. */
  variant_id: string | null;
  title: string;
  price: number | null;
  compare_at_price: number | null;
  currency: string | null;
  image_url: string | null;
  selected_options: { name: string; value: string }[];
  available_for_sale: boolean | null;
}

export interface StorefrontProductDetail extends StorefrontProductCard {
  description: string | null;
  description_html: string | null;
  seo_title: string | null;
  seo_description: string | null;
  store_url: string | null;
  /** Host that owns the basket and payment pages, when the store is paired. */
  checkout_domain: string | null;
  options: { name: string; values: string[] }[];
  media: StorefrontMedia[];
  variants: StorefrontVariant[];
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

/** Pulls the numeric identifier out of a store global id. */
function numericId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/(\d+)\s*$/);
  return match ? match[1]! : null;
}

let checkoutDomainCache: { value: string | null; expires: number } | null = null;

/**
 * Resolves the host that serves the basket and payment pages. The owner can
 * set a dedicated checkout host when the store's own primary domain is used
 * elsewhere, otherwise the paired store host is used.
 */
export async function getCheckoutDomain(): Promise<string | null> {
  if (checkoutDomainCache && checkoutDomainCache.expires > Date.now()) {
    return checkoutDomainCache.value;
  }
  let value: string | null = null;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: integration } = await supabaseAdmin
      .from("integrations")
      .select("id")
      .eq("provider", "shopify")
      .maybeSingle();
    if ((integration as any)?.id) {
      const { data: rows } = await supabaseAdmin
        .from("integration_settings")
        .select("key, value")
        .eq("integration_id", (integration as any).id)
        .in("key", ["checkout_domain", "shop_domain"]);
      const map = new Map(((rows ?? []) as any[]).map((row) => [row.key, row.value as string | null]));
      value = (map.get("checkout_domain") || map.get("shop_domain") || null) as string | null;
    }
  } catch {
    value = null;
  }
  checkoutDomainCache = { value, expires: Date.now() + 60_000 };
  return value;
}


/** Store supplied HTML is trimmed to a safe subset before it reaches a page. */
function sanitiseHtml(input: unknown): string | null {
  if (typeof input !== "string" || !input.trim()) return null;
  return input
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*\/?\s*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript:/gi, "")
    .trim();
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
    .select(DETAIL_COLUMNS)
    .eq("handle", handle)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as any;

  const [{ data: enrichment }, { data: joins }, { data: seoRecord }, { data: mediaRows }, { data: variantRows }] = await Promise.all([
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
    supabase
      .from("shopify_product_media")
      .select("url, alt_text, width, height, position")
      .eq("product_id", row.id)
      .order("position", { ascending: true }),
    supabase
      .from("shopify_product_variants")
      .select(
        "id, shopify_variant_id, title, price, compare_at_price, currency, image_url, selected_options, available_for_sale, position",
      )
      .eq("product_id", row.id)
      .order("position", { ascending: true }),
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
  if (collectionIds.length > 0) {
    const { data: siblingJoins } = await supabase
      .from("shopify_product_collections")
      .select("product_id")
      .in("collection_id", collectionIds)
      .limit(60);
    const siblingIds = [
      ...new Set(((siblingJoins ?? []) as any[]).map((join) => join.product_id as string)),
    ].filter((id) => id !== row.id);
    if (siblingIds.length > 0) {
      const { data: siblings } = await supabase
        .from("shopify_products")
        .select(CARD_COLUMNS)
        .in("id", siblingIds.slice(0, 24))
        .order("title", { ascending: true })
        .limit(4);
      related = ((siblings ?? []) as any[]).map((sibling) => mapCard(sibling));
    }
  }
  if (related.length === 0 && row.product_type) {
    const { data: siblings } = await supabase
      .from("shopify_products")
      .select(CARD_COLUMNS)
      .eq("product_type", row.product_type)
      .neq("handle", handle)
      .order("title", { ascending: true })
      .limit(4);
    related = ((siblings ?? []) as any[]).map((sibling) => mapCard(sibling));
  }

  const media: StorefrontMedia[] = ((mediaRows ?? []) as any[]).map((m) => ({
    url: m.url,
    alt: m.alt_text ?? null,
    width: m.width ?? null,
    height: m.height ?? null,
  }));

  const variants: StorefrontVariant[] = ((variantRows ?? []) as any[]).map((v) => ({
    id: v.id,
    variant_id: numericId(v.shopify_variant_id),
    title: v.title,
    price: v.price ?? null,
    compare_at_price: v.compare_at_price ?? null,
    currency: v.currency ?? row.currency ?? null,
    image_url: v.image_url ?? null,
    selected_options: Array.isArray(v.selected_options)
      ? v.selected_options.filter(
          (o: any) => o && typeof o.name === "string" && typeof o.value === "string",
        )
      : [],
    available_for_sale: v.available_for_sale ?? null,
  }));

  const options = Array.isArray(row.options)
    ? (row.options as any[]).flatMap((o) =>
        o && typeof o.name === "string" && Array.isArray(o.values)
          ? [{ name: o.name as string, values: o.values.filter((x: any) => typeof x === "string") }]
          : [],
      )
    : [];

  return {
    ...mapCard(row, content.summary ?? null),
    description: row.description ?? null,
    description_html: sanitiseHtml(row.description_html),
    seo_title: row.seo_title ?? null,
    seo_description: row.seo_description ?? null,
    store_url: row.online_store_url ?? null,
    options,
    media,
    variants,
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
