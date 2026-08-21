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
  /** Raw supplier classification, kept only for traceability. */
  product_type: string | null;
  /** Canonical NUR GOODS category. This is what customer facing pages use. */
  category_slug: string | null;
  category_name: string | null;
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

export interface StorefrontCategoryFacet {
  slug: string;
  name: string;
  parent_slug: string | null;
  products: number;
}

export interface StorefrontFacets {
  categories: StorefrontCategoryFacet[];
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

interface CategoryRow {
  id: string;
  slug: string;
  name: string;
  parent_id: string | null;
}

/** Live canonical taxonomy, enabled nodes only. */
async function loadTaxonomyUncached(supabase: any): Promise<{
  bySlug: Map<string, CategoryRow>;
  childrenOf: Map<string, string[]>;
}> {
  const { data } = await supabase
    .from("catalogue_categories")
    .select("id, slug, name, parent_id")
    .eq("enabled", true);
  const rows = ((data ?? []) as CategoryRow[]);
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const childrenOf = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parent_id) continue;
    const parent = byId.get(row.parent_id);
    if (!parent) continue;
    childrenOf.set(parent.slug, [...(childrenOf.get(parent.slug) ?? []), row.slug]);
  }
  return { bySlug, childrenOf };
}

function loadTaxonomy(supabase: any) {
  return cached("taxonomy", () => loadTaxonomyUncached(supabase));
}

/** A category plus everything beneath it, so parent pages include their leaves. */
function categoryBranch(slug: string, childrenOf: Map<string, string[]>): string[] {
  const out: string[] = [];
  const stack = [slug];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (out.includes(current)) continue;
    out.push(current);
    stack.push(...(childrenOf.get(current) ?? []));
  }
  return out;
}

/** Canonical category per product, resolved from validated classifications. */
async function loadProductCategories(
  supabase: any,
  productIds: string[],
): Promise<Map<string, { slug: string; name: string }>> {
  if (productIds.length === 0) return new Map();
  const [{ data: classifications }, taxonomy] = await Promise.all([
    supabase.rpc("public_product_categories").in("product_id", productIds),
    loadTaxonomy(supabase),
  ]);
  const out = new Map<string, { slug: string; name: string }>();
  for (const row of ((classifications ?? []) as any[])) {
    const node = row.category_slug ? taxonomy.bySlug.get(row.category_slug) : null;
    if (node) out.set(row.product_id, { slug: node.slug, name: node.name });
  }
  return out;
}

/**
 * Products held back from customers by de-duplication or by product intake.
 * Only high confidence duplicate groups suppress, and intake only holds a
 * product while a required quality or intelligence gate has not passed. The
 * supplier record is never altered, only the NUR GOODS presentation.
 */
export async function loadHiddenProductIds(supabase: any): Promise<string[]> {
  const [{ data: duplicates }, { data: intake }] = await Promise.all([
    // Minimal suppression projection. Internal duplicate evidence, pricing
    // analysis and admin decisions stay private to staff tooling.
    supabase.rpc("public_suppressed_products"),
    supabase.rpc("hidden_intake_product_ids"),
  ]);
  const ids = new Set<string>();
  for (const row of ((duplicates ?? []) as any[])) ids.add(row.product_id as string);
  for (const row of ((intake ?? []) as any[])) {
    const value = typeof row === "string" ? row : row?.product_id;
    if (value) ids.add(value as string);
  }
  return [...ids];
}


async function loadSuppressedProductIds(supabase: any): Promise<string[]> {
  // Suppression only changes when a job rebuilds it, so the short lived
  // process cache keeps product pages down to their own indexed reads.
  return cached("suppressed-ids", () => loadHiddenProductIds(supabase));
}

/** Cached duplicate suppression rows, shared by every product page render. */
async function loadSuppressionRows(supabase: any): Promise<any[]> {
  return cached("suppression-rows", async () => {
    const { data } = await supabase.rpc("public_suppressed_products");
    return (data ?? []) as any[];
  });
}


/** Canonical listing for a suppressed product, used for redirects and rel canonical. */
export async function resolveCanonicalHandle(
  supabase: any,
  productId: string,
): Promise<{ suppressed: boolean; canonical_handle: string | null }> {
  const rows = await loadSuppressionRows(supabase);
  const match = rows.find((row) => row.product_id === productId);
  if (!match) return { suppressed: false, canonical_handle: null };
  return { suppressed: true, canonical_handle: (match.canonical_handle as string | null) ?? null };
}

function mapCard(
  row: any,
  summary: string | null = null,
  category: { slug: string; name: string } | null = null,
): StorefrontProductCard {
  return {
    id: row.id,
    handle: row.handle,
    title: row.title,
    product_type: row.product_type ?? null,
    category_slug: category?.slug ?? null,
    category_name: category?.name ?? null,
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

/**
 * Storefront read model.
 *
 * `storefront_snapshot` is a locally maintained projection of validated,
 * publishable listings. It already excludes suppressed duplicates and listings
 * still held by intake, and it carries the canonical category, summary and
 * collection membership inline. Public pages therefore never fan out across
 * classifications, enrichment and suppression helpers on a customer request.
 */
const SNAPSHOT_CARD_COLUMNS =
  "product_id, handle, title, product_type, vendor, tags, category_slug, category_name, image_url, price_min, price_max, currency, compare_at_price_min, available_for_sale, variant_count, summary, updated_at";

function mapSnapshotCard(row: any): StorefrontProductCard {
  return {
    id: row.product_id,
    handle: row.handle,
    title: row.title,
    product_type: row.product_type ?? null,
    category_slug: row.category_slug ?? null,
    category_name: row.category_name ?? null,
    vendor: row.vendor ?? null,
    tags: Array.isArray(row.tags) ? row.tags : [],
    image_url: row.image_url ?? null,
    price_min: row.price_min ?? null,
    price_max: row.price_max ?? null,
    currency: row.currency ?? null,
    variant_count: row.variant_count ?? 0,
    compare_at_price_min: row.compare_at_price_min ?? null,
    available_for_sale: row.available_for_sale ?? null,
    summary: typeof row.summary === "string" && row.summary.trim() ? row.summary : null,
    updated_at: row.updated_at ?? null,
  };
}

function applySnapshotSort(builder: any, sort: StorefrontSort) {
  switch (sort) {
    case "price_asc":
      return builder.order("price_min", { ascending: true, nullsFirst: false });
    case "price_desc":
      return builder.order("price_max", { ascending: false, nullsFirst: false });
    case "newest":
      return builder.order("updated_at", { ascending: false, nullsFirst: false });
    case "title_desc":
      return builder.order("title", { ascending: false });
    default:
      return builder.order("title", { ascending: true });
  }
}

/**
 * Short lived process cache. Snapshot data changes only when a job rebuilds it.
 * Entries are kept after they expire so that a slow or timing out database read
 * can serve the previous answer instead of blanking a customer facing page.
 */
const memo = new Map<string, { at: number; value: unknown }>();
const MEMO_MS = 60_000;

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.value as T;
  try {
    const value = await load();
    memo.set(key, { at: Date.now(), value });
    return value;
  } catch (error) {
    if (hit) return hit.value as T;
    throw error;
  }
}


export async function listStorefrontProducts(input: {
  query?: string | undefined;
  productType?: string | undefined;
  category?: string | undefined;
  collectionHandle?: string | undefined;
  tag?: string | undefined;
  sort?: StorefrontSort | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}): Promise<{ items: StorefrontProductCard[]; total: number; hasMore: boolean }> {
  const supabase = await publicClient();
  const { limit, offset } = normalisePage(input);
  const memoKey = `products:${JSON.stringify({ ...input, limit, offset })}`;
  return cached(memoKey, async () => {


  let builder = supabase
    .from("storefront_snapshot")
    .select(SNAPSHOT_CARD_COLUMNS, { count: "exact" })
    .range(offset, offset + limit - 1);
  builder = applySnapshotSort(builder, input.sort ?? "featured");

  if (input.category) {
    const { childrenOf, bySlug } = await loadTaxonomy(supabase);
    if (!bySlug.has(input.category)) return { items: [], total: 0, hasMore: false };
    builder = builder.in("category_slug", categoryBranch(input.category, childrenOf));
  }
  if (input.collectionHandle) builder = builder.contains("collection_handles", [input.collectionHandle]);
  if (input.productType) builder = builder.eq("product_type", input.productType);
  if (input.tag) builder = builder.contains("tags", [input.tag]);

  const term = input.query ? safeTerm(input.query) : "";
  if (term) builder = builder.ilike("search_text", `%${term.toLowerCase()}%`);

  const { data, error, count } = await builder;
  if (error) throw new Error(error.message);
  const items = ((data ?? []) as any[]).map(mapSnapshotCard);
  const total = count ?? items.length;
    return { items, total, hasMore: offset + items.length < total };
  });
}


export async function listStorefrontFacets(): Promise<StorefrontFacets> {
  const supabase = await publicClient();
  return cached("facets", async () => {
    const [{ data, error }, taxonomy] = await Promise.all([
      supabase.from("storefront_snapshot").select("product_type, tags, category_slug").limit(5000),
      loadTaxonomy(supabase),
    ]);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as any[];

    const types = new Set<string>();
    const tagCounts = new Map<string, number>();
    const direct = new Map<string, number>();
    for (const row of rows) {
      if (typeof row.product_type === "string" && row.product_type.trim()) {
        types.add(row.product_type.trim());
      }
      for (const tag of Array.isArray(row.tags) ? row.tags : []) {
        if (typeof tag !== "string" || !tag.trim()) continue;
        const key = tag.trim();
        tagCounts.set(key, (tagCounts.get(key) ?? 0) + 1);
      }
      if (row.category_slug) direct.set(row.category_slug, (direct.get(row.category_slug) ?? 0) + 1);
    }
    // Only tags that group more than one product are useful as a filter.
    const tags = [...tagCounts.entries()]
      .filter(([, hits]) => hits > 1)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 24)
      .map(([tag]) => tag);

    const { bySlug, childrenOf } = taxonomy;
    const parentBySlug = new Map<string, string | null>();
    for (const [parent, children] of childrenOf) {
      for (const child of children) parentBySlug.set(child, parent);
    }
    const categories: StorefrontCategoryFacet[] = [...bySlug.values()]
      .map((node) => ({
        slug: node.slug,
        name: node.name,
        parent_slug: parentBySlug.get(node.slug) ?? null,
        products: categoryBranch(node.slug, childrenOf).reduce(
          (sum, slug) => sum + (direct.get(slug) ?? 0),
          0,
        ),
      }))
      .filter((node) => node.products > 0)
      .sort((a, b) => b.products - a.products || a.name.localeCompare(b.name));

    return {
      categories,
      product_types: [...types].sort((a, b) => a.localeCompare(b)),
      tags,
      total: rows.length,
    };
  });
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
  const all = await cached("collections", async () => {
    // Two indexed local reads only. The snapshot already excludes suppressed
    // duplicates and listings held by intake, so no suppression fan out is
    // needed on a customer request.
    const [{ data, error }, { data: snapshot }] = await Promise.all([
      supabase
        .from("shopify_collections")
        .select(
          "id, handle, title, description, image_url, product_count, shopify_updated_at, last_synced_at",
        )
        .order("title", { ascending: true })
        .limit(100),
      supabase.from("storefront_snapshot").select("collection_handles, image_url").limit(5000),
    ]);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as any[];
    if (rows.length === 0) return [] as StorefrontCollection[];

    // The store does not always set a collection image, so a genuine member
    // product image stands in. Nothing is invented: the image always belongs to
    // a product inside that collection.
    const counts = new Map<string, number>();
    const covers = new Map<string, string>();
    for (const row of ((snapshot ?? []) as any[])) {
      const handles: string[] = Array.isArray(row.collection_handles) ? row.collection_handles : [];
      for (const handle of handles) {
        if (typeof handle !== "string") continue;
        counts.set(handle, (counts.get(handle) ?? 0) + 1);
        if (row.image_url && !covers.has(handle)) covers.set(handle, row.image_url);
      }
    }

    return rows.map((row) => {
      const collection = mapCollection(row);
      return {
        ...collection,
        product_count: counts.get(collection.handle) ?? 0,
        image_url: collection.image_url ?? covers.get(collection.handle) ?? null,
      };
    });
  });
  return options?.withProductsOnly ? all.filter((c) => c.product_count > 0) : all;
}


/**
 * Storefront category tiles for the homepage rail. Counts and cover images
 * come from the local storefront snapshot keyed by the canonical NUR taxonomy
 * slug, never from Shopify/Zendrop product_type or collection labels, so a
 * supplier mis-labelled product can never surface under the wrong aisle.
 */
export interface StorefrontCategory {
  slug: string;
  name: string;
  description: string | null;
  image_url: string | null;
  product_count: number;
}

export async function listStorefrontCategories(options?: {
  withProductsOnly?: boolean;
}): Promise<StorefrontCategory[]> {
  const supabase = await publicClient();
  const all = await cached("categories", async () => {
    const { data, error } = await supabase
      .from("storefront_snapshot")
      .select("category_slug, category_name, image_url")
      .not("category_slug", "is", null);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{
      category_slug: string | null;
      category_name: string | null;
      image_url: string | null;
    }>;
    const bySlug = new Map<string, { count: number; name: string; cover: string | null }>();
    for (const row of rows) {
      if (!row.category_slug) continue;
      const entry = bySlug.get(row.category_slug) ?? {
        count: 0,
        name: row.category_name ?? row.category_slug,
        cover: null,
      };
      entry.count += 1;
      if (!entry.cover && row.image_url) entry.cover = row.image_url;
      bySlug.set(row.category_slug, entry);
    }
    return [...bySlug.entries()].map(([slug, entry]) => ({
      slug,
      name: entry.name,
      description: null,
      image_url: entry.cover,
      product_count: entry.count,
    }));
  });
  return options?.withProductsOnly ? all.filter((c) => c.product_count > 0) : all;
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
  /** True when that host genuinely answers as the store basket. */
  checkout_ready: boolean;
  /** True when headless Storefront checkout is configured and verified. */
  storefront_checkout: boolean;

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
  /** Canonical category trail, root first, used for navigation and breadcrumbs. */
  category_path: { slug: string; name: string }[];
  /** True when de-duplication hides this listing in favour of another. */
  duplicate_suppressed: boolean;
  /** Handle of the listing customers and search engines should use instead. */
  duplicate_canonical_handle: string | null;
  /** Validated search intelligence. Absent when nothing has been published. */
  intelligence: {
    seo_title: string | null;
    meta_description: string | null;
    image_alt: string | null;
    entities: string[];
    keywords: string[];
    faqs: { question: string; answer: string }[];
    internal_links: { target_type: string; target_reference: string; anchor_text: string }[];
    schema: Record<string, any> | null;
  } | null;
}

/** Pulls the numeric identifier out of a store global id. */
function numericId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/(\d+)\s*$/);
  return match ? match[1]! : null;
}

/**
 * Checkout readiness is resolved by a background job and stored locally, so a
 * customer request never waits on the store host. Public pages read this one
 * small row and nothing else.
 */
export interface CheckoutState {
  checkout_domain: string | null;
  checkout_ready: boolean;
  storefront_checkout: boolean;
  checked_at: string | null;
}

const EMPTY_CHECKOUT_STATE: CheckoutState = {
  checkout_domain: null,
  checkout_ready: false,
  storefront_checkout: false,
  checked_at: null,
};

export async function getCheckoutState(): Promise<CheckoutState> {
  return cached("checkout-state", async () => {
    try {
      const supabase = await publicClient();
      const { data } = await supabase
        .from("storefront_checkout_state" as never)
        .select("checkout_domain, checkout_ready, storefront_checkout, checked_at")
        .maybeSingle();
      if (!data) return EMPTY_CHECKOUT_STATE;
      const row = data as any;
      return {
        checkout_domain: row.checkout_domain ?? null,
        checkout_ready: Boolean(row.checkout_ready),
        storefront_checkout: Boolean(row.storefront_checkout),
        checked_at: row.checked_at ?? null,
      };
    } catch {
      // Fail closed: a missing record hides the basket rather than offering a
      // link that could dead end.
      return EMPTY_CHECKOUT_STATE;
    }
  });
}

/**
 * Background refresh. Only staff tooling and scheduled jobs call this, never a
 * page render. It performs the remote probes and stores the verdict locally.
 */
export async function refreshCheckoutState(): Promise<CheckoutState> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let domain: string | null = null;
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
    domain = (map.get("checkout_domain") || map.get("shop_domain") || null) as string | null;
  }

  const { probeCheckoutHost, isStorefrontCheckoutReady } = await import(
    "@/lib/services/shopify-storefront.server"
  );
  let checkoutReady = false;
  if (domain) {
    try {
      const probe = await probeCheckoutHost(domain, { force: true });
      checkoutReady = probe?.servesStore ?? false;
    } catch {
      checkoutReady = false;
    }
  }
  let storefrontCheckout = false;
  try {
    storefrontCheckout = await isStorefrontCheckoutReady();
  } catch {
    storefrontCheckout = false;
  }

  const next: CheckoutState = {
    checkout_domain: domain,
    checkout_ready: checkoutReady,
    storefront_checkout: storefrontCheckout,
    checked_at: new Date().toISOString(),
  };
  await supabaseAdmin
    .from("storefront_checkout_state" as never)
    .upsert({ id: true, ...next } as any, { onConflict: "id" });
  memo.delete("checkout-state");
  return next;
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

  const hiddenProductIds = new Set(await loadSuppressedProductIds(supabase));
  const duplicateIdentity = await resolveCanonicalHandle(supabase, row.id);

  // Canonical category trail. Supplier categories never drive navigation.
  const [{ data: classification }, taxonomy, { data: seoIntel }] = await Promise.all([
    supabase
      .rpc("public_product_categories")
      .eq("product_id", row.id)
      .maybeSingle(),
    loadTaxonomy(supabase),
    supabase
      .from("product_seo_intelligence")
      .select(
        "seo_title, meta_description, image_alt, entities, keywords, faqs, internal_links, schema_inputs, validation_state, auto_published",
      )
      .eq("product_id", row.id)
      .maybeSingle(),
  ]);

  const categoryPath: { slug: string; name: string }[] = [];
  const canonicalSlug = (classification as any)?.category_slug as string | undefined;
  if (canonicalSlug) {
    const byId = new Map([...taxonomy.bySlug.values()].map((node) => [node.id, node]));
    let node = taxonomy.bySlug.get(canonicalSlug) ?? null;
    while (node) {
      categoryPath.unshift({ slug: node.slug, name: node.name });
      node = node.parent_id ? (byId.get(node.parent_id) ?? null) : null;
    }
  }

  // Only validated, automatically published intelligence reaches a customer.
  const intel = seoIntel as any;
  const intelligence =
    intel && intel.auto_published && intel.validation_state !== "rejected"
      ? {
          seo_title: (intel.seo_title as string | null) ?? null,
          meta_description: (intel.meta_description as string | null) ?? null,
          image_alt: (intel.image_alt as string | null) ?? null,
          entities: stringList(intel.entities),
          keywords: stringList(intel.keywords),
          faqs: pairList(intel.faqs, "question", "answer"),
          internal_links: (Array.isArray(intel.internal_links) ? intel.internal_links : []).filter(
            (link: any) =>
              link &&
              typeof link.target_type === "string" &&
              typeof link.target_reference === "string" &&
              typeof link.anchor_text === "string",
          ),
          schema: (intel.schema_inputs as Record<string, any> | null) ?? null,
        }
      : null;

  if (faqs.length === 0 && intelligence) faqs = intelligence.faqs;

  let related: StorefrontProductCard[] = [];
  // Prefer siblings inside the same canonical category over supplier grouping.
  if (canonicalSlug) {
    const branch = categoryBranch(canonicalSlug, taxonomy.childrenOf);
    // Siblings come from the publishable snapshot, so no suppression or
    // classification fan out happens while a customer waits.
    const { data: siblings } = await supabase
      .from("storefront_snapshot")
      .select(SNAPSHOT_CARD_COLUMNS)
      .in("category_slug", branch)
      .neq("handle", handle)
      .order("title", { ascending: true })
      .limit(5);
    related = ((siblings ?? []) as any[])
      .filter((sibling) => sibling.product_id !== row.id)
      .slice(0, 4)
      .map((sibling) => mapSnapshotCard(sibling));
  }
  if (related.length === 0 && collectionIds.length > 0) {

    const { data: siblingJoins } = await supabase
      .from("shopify_product_collections")
      .select("product_id")
      .in("collection_id", collectionIds)
      .limit(60);
    const siblingIds = [
      ...new Set(((siblingJoins ?? []) as any[]).map((join) => join.product_id as string)),
    ].filter((id) => id !== row.id && !hiddenProductIds.has(id));
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

  const checkoutState = await getCheckoutState();

  const options = Array.isArray(row.options)
    ? (row.options as any[]).flatMap((o) =>
        o && typeof o.name === "string" && Array.isArray(o.values)
          ? [{ name: o.name as string, values: o.values.filter((x: any) => typeof x === "string") }]
          : [],
      )
    : [];

  return {
    ...mapCard(
      row,
      content.summary ?? null,
      categoryPath.length > 0 ? categoryPath[categoryPath.length - 1]! : null,
    ),
    category_path: categoryPath,
    duplicate_suppressed: duplicateIdentity.suppressed,
    duplicate_canonical_handle: duplicateIdentity.canonical_handle,
    intelligence,
    description: row.description ?? null,
    description_html: sanitiseHtml(row.description_html),
    // Canonical metadata wins over supplier metadata when it has been validated.
    seo_title: intelligence?.seo_title ?? row.seo_title ?? null,
    seo_description: intelligence?.meta_description ?? row.seo_description ?? null,
    store_url: row.online_store_url ?? null,
    checkout_domain: checkoutState.checkout_domain,
    checkout_ready: checkoutState.checkout_ready,
    storefront_checkout: checkoutState.storefront_checkout,

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

export interface StorefrontCategoryChild {
  slug: string;
  name: string;
  products: number;
}

export interface StorefrontCategoryPage {
  slug: string;
  name: string;
  description: string | null;
  parent: { slug: string; name: string } | null;
  children: StorefrontCategoryChild[];
  total: number;
  items: StorefrontProductCard[];
}

/**
 * Crawlable category surface. Counts and products come from the canonical
 * taxonomy only, never from supplier product_type, and include the whole
 * branch so parent pages are never empty.
 */
export async function getStorefrontCategory(
  slug: string,
  options?: { limit?: number | undefined; offset?: number | undefined },
): Promise<StorefrontCategoryPage | null> {
  const supabase = await publicClient();
  const { data: rows } = await supabase
    .from("catalogue_categories")
    .select("id, slug, name, parent_id, description")
    .eq("enabled", true);
  const nodes = (rows ?? []) as Array<{
    id: string;
    slug: string;
    name: string;
    parent_id: string | null;
    description: string | null;
  }>;
  const node = nodes.find((row) => row.slug === slug);
  if (!node) return null;

  const byId = new Map(nodes.map((row) => [row.id, row]));
  const childrenOf = new Map<string, string[]>();
  for (const row of nodes) {
    if (!row.parent_id) continue;
    const parent = byId.get(row.parent_id);
    if (!parent) continue;
    childrenOf.set(parent.slug, [...(childrenOf.get(parent.slug) ?? []), row.slug]);
  }

  const hidden = new Set(await loadSuppressedProductIds(supabase));
  const branch = categoryBranch(node.slug, childrenOf);
  const { data: classified } = await supabase
    .rpc("public_product_categories")
    .in("category_slug", branch);
  const direct = new Map<string, number>();
  for (const row of ((classified ?? []) as any[])) {
    if (!row.category_slug || hidden.has(row.product_id)) continue;
    direct.set(row.category_slug, (direct.get(row.category_slug) ?? 0) + 1);
  }

  const children: StorefrontCategoryChild[] = (childrenOf.get(node.slug) ?? [])
    .map((childSlug) => {
      const child = nodes.find((row) => row.slug === childSlug)!;
      return {
        slug: child.slug,
        name: child.name,
        products: categoryBranch(child.slug, childrenOf).reduce(
          (sum, key) => sum + (direct.get(key) ?? 0),
          0,
        ),
      };
    })
    .filter((child) => child.products > 0)
    .sort((a, b) => b.products - a.products || a.name.localeCompare(b.name));

  const page = await listStorefrontProducts({
    category: node.slug,
    limit: options?.limit,
    offset: options?.offset,
  });

  const parentRow = node.parent_id ? byId.get(node.parent_id) : null;
  return {
    slug: node.slug,
    name: node.name,
    description: node.description ?? null,
    parent: parentRow ? { slug: parentRow.slug, name: parentRow.name } : null,
    children,
    total: page.total,
    items: page.items,
  };
}

export interface StorefrontStats {
  /** Publicly sellable listings in the local storefront projection. */
  products: number;
  /** Variants belonging to those same listings. */
  variants: number;
  /** When the projection these figures come from was last rebuilt. */
  refreshed_at: string | null;
}

const STATS_PAGE = 1000;
const STATS_MAX_PAGES = 40;

/**
 * Catalogue size, read only from the local storefront projection. Held,
 * suppressed, draft and otherwise non sellable records never enter that
 * projection, so both figures are sellable by construction and move only when
 * a snapshot rebuild lands. No upstream call happens on render.
 */
export async function getStorefrontStats(): Promise<StorefrontStats> {
  return cached("storefront-stats", async () => {
    const supabase = await publicClient();

    const [{ count }, { data: meta }] = await Promise.all([
      supabase.from("storefront_snapshot").select("product_id", { count: "exact", head: true }),
      supabase.from("storefront_snapshot_meta").select("refreshed_at").maybeSingle(),
    ]);

    let variants = 0;
    for (let page = 0; page < STATS_MAX_PAGES; page += 1) {
      const from = page * STATS_PAGE;
      const { data, error } = await supabase
        .from("storefront_snapshot")
        .select("variant_count")
        .range(from, from + STATS_PAGE - 1);
      if (error) break;
      const rows = (data ?? []) as { variant_count: number | null }[];
      for (const row of rows) variants += row.variant_count ?? 0;
      if (rows.length < STATS_PAGE) break;
    }

    return {
      products: count ?? 0,
      variants,
      refreshed_at: (meta as { refreshed_at?: string | null } | null)?.refreshed_at ?? null,
    };
  });
}
