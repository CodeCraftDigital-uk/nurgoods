/**
 * Canonical catalogue search service.
 *
 * This is the single search implementation for NUR GOODS. The Store page, the
 * public API, the MCP connectors and any future natural language search all
 * resolve to `searchCatalogue`, so there is one ranking model and one
 * suppression rule set. Nothing here invents products, prices, stock or facts:
 * every field is read from synced store data, validated classifications and
 * published enrichment.
 *
 * Suppressed duplicate listings are removed from the index itself, so they can
 * never leak into results, suggestions, facets, counts or pagination.
 */
import { publicClient } from "./queries.server";
import type { StorefrontProductCard } from "./storefront.server";

export type CatalogueSort =
  | "relevance"
  | "featured"
  | "price_asc"
  | "price_desc"
  | "newest"
  | "title_desc";

export const CATALOGUE_SORTS: CatalogueSort[] = [
  "relevance",
  "featured",
  "price_asc",
  "price_desc",
  "newest",
  "title_desc",
];

/**
 * Structured catalogue constraints. Deterministic keyword search fills this in
 * directly. A future natural language layer parses an instruction such as
 * "gift for a man under thirty pounds who likes grooming" into exactly this
 * shape and then calls the same service, so AI can rank and constrain but can
 * never introduce a product that is not in the canonical catalogue.
 */
export interface CatalogueQuery {
  query?: string | undefined;
  category?: string | undefined;
  collectionHandle?: string | undefined;
  tag?: string | undefined;
  priceMin?: number | undefined;
  priceMax?: number | undefined;
  availableOnly?: boolean | undefined;
  sort?: CatalogueSort | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

/**
 * Extension point for natural language search. An implementation receives the
 * shopper's words and returns structured constraints for this service. It is
 * intentionally not wired into keyword search, so ordinary browsing never
 * incurs a model call.
 */
export type CatalogueIntentResolver = (
  instruction: string,
) => Promise<{ constraints: CatalogueQuery; rationale?: string }>;

export interface CatalogueFacets {
  categories: Array<{ slug: string; name: string; parent_slug: string | null; products: number }>;
  tags: Array<{ tag: string; products: number }>;
  collections: Array<{ handle: string; title: string; products: number }>;
  price: { min: number | null; max: number | null; currency: string | null };
  available: number;
  total: number;
}

export interface CatalogueSearchResult {
  items: StorefrontProductCard[];
  total: number;
  hasMore: boolean;
  facets: CatalogueFacets;
  /** Present only when the raw term matched nothing and a close term did. */
  correctedQuery: string | null;
}

interface IndexEntry {
  card: StorefrontProductCard;
  haystack: string;
  titleLower: string;
  categorySlug: string | null;
  collections: string[];
  tagsLower: string[];
  updatedMs: number;
}

interface CatalogueIndex {
  entries: IndexEntry[];
  categories: Array<{ slug: string; name: string; parent_slug: string | null }>;
  branchOf: Map<string, string[]>;
  collectionTitles: Map<string, string>;
  builtAt: number;
}

const INDEX_TTL_MS = 60_000;
let indexCache: CatalogueIndex | null = null;
let indexPromise: Promise<CatalogueIndex> | null = null;

function normalise(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenise(value: string): string[] {
  return normalise(value).split(" ").filter(Boolean);
}

/** Bounded edit distance, used only for short typo tolerance. */
function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const diff = a.length - b.length;
  if (diff > 1 || diff < -1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (a.length < b.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

async function buildIndex(): Promise<CatalogueIndex> {
  const supabase = await publicClient();

  const [{ data: suppressedRows }, { data: intakeRows }, { data: productRows }, { data: categoryRows }] =
    await Promise.all([
      supabase.from("duplicate_group_members").select("product_id").eq("suppressed", true).limit(5000),
      supabase.rpc("hidden_intake_product_ids"),
      supabase
        .from("shopify_products")
        .select(
          "id, handle, title, product_type, vendor, tags, featured_image_url, price_min, price_max, currency, compare_at_price_min, available_for_sale, variant_count, description, shopify_updated_at, last_synced_at",
        )
        .limit(2000),
      supabase.from("catalogue_categories").select("id, slug, name, parent_id").eq("enabled", true),
    ]);

  const suppressed = new Set(((suppressedRows ?? []) as any[]).map((row) => row.product_id as string));
  for (const row of ((intakeRows ?? []) as any[])) {
    const value = typeof row === "string" ? row : (row as any)?.product_id;
    if (value) suppressed.add(value as string);
  }
  const products = ((productRows ?? []) as any[]).filter((row) => !suppressed.has(row.id));


  const productIds = products.map((row) => row.id as string);

  const nodes = (categoryRows ?? []) as Array<{
    id: string;
    slug: string;
    name: string;
    parent_id: string | null;
  }>;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const childrenOf = new Map<string, string[]>();
  const parentBySlug = new Map<string, string | null>();
  for (const node of nodes) {
    const parent = node.parent_id ? nodeById.get(node.parent_id) : null;
    parentBySlug.set(node.slug, parent?.slug ?? null);
    if (parent) childrenOf.set(parent.slug, [...(childrenOf.get(parent.slug) ?? []), node.slug]);
  }
  const branchOf = new Map<string, string[]>();
  for (const node of nodes) {
    const out: string[] = [];
    const stack = [node.slug];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (out.includes(current)) continue;
      out.push(current);
      stack.push(...(childrenOf.get(current) ?? []));
    }
    branchOf.set(node.slug, out);
  }

  const [{ data: classifications }, { data: enrichment }, { data: joins }, { data: collections }] =
    await Promise.all([
      productIds.length
        ? supabase
            .from("product_classifications")
            .select("product_id, category_slug")
            .in("product_id", productIds)
        : Promise.resolve({ data: [] as any[] }),
      productIds.length
        ? supabase.from("product_enrichment").select("product_id, summary").in("product_id", productIds)
        : Promise.resolve({ data: [] as any[] }),
      supabase.from("shopify_product_collections").select("collection_id, product_id").limit(5000),
      supabase.from("shopify_collections").select("id, handle, title").limit(200),
    ]);

  const categoryByProduct = new Map<string, string>();
  for (const row of (classifications ?? []) as any[]) {
    if (row.category_slug) categoryByProduct.set(row.product_id, row.category_slug);
  }
  const summaryByProduct = new Map<string, string>();
  for (const row of (enrichment ?? []) as any[]) {
    if (typeof row.summary === "string" && row.summary.trim()) {
      summaryByProduct.set(row.product_id, row.summary.trim());
    }
  }
  const collectionById = new Map(
    ((collections ?? []) as any[]).map((row) => [row.id as string, row as { handle: string; title: string }]),
  );
  const collectionTitles = new Map<string, string>();
  const collectionsByProduct = new Map<string, string[]>();
  for (const join of (joins ?? []) as any[]) {
    const collection = collectionById.get(join.collection_id);
    if (!collection || suppressed.has(join.product_id)) continue;
    collectionTitles.set(collection.handle, collection.title);
    collectionsByProduct.set(join.product_id, [
      ...(collectionsByProduct.get(join.product_id) ?? []),
      collection.handle,
    ]);
  }

  const nameBySlug = new Map(nodes.map((node) => [node.slug, node.name]));

  const entries: IndexEntry[] = products.map((row) => {
    const categorySlug = categoryByProduct.get(row.id) ?? null;
    const categoryName = categorySlug ? (nameBySlug.get(categorySlug) ?? null) : null;
    const tags: string[] = Array.isArray(row.tags) ? row.tags.filter((tag: unknown) => typeof tag === "string") : [];
    const summary = summaryByProduct.get(row.id) ?? null;
    const card: StorefrontProductCard = {
      id: row.id,
      handle: row.handle,
      title: row.title,
      product_type: row.product_type ?? null,
      category_slug: categorySlug,
      category_name: categoryName,
      vendor: row.vendor ?? null,
      tags,
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
    const productCollections = collectionsByProduct.get(row.id) ?? [];
    const haystack = normalise(
      [
        row.title,
        categoryName,
        row.product_type,
        row.vendor,
        tags.join(" "),
        summary,
        typeof row.description === "string" ? row.description.slice(0, 1200) : "",
        productCollections.map((handle) => collectionTitles.get(handle) ?? handle).join(" "),
      ]
        .filter(Boolean)
        .join(" "),
    );
    return {
      card,
      haystack,
      titleLower: normalise(row.title ?? ""),
      categorySlug,
      collections: productCollections,
      tagsLower: tags.map((tag) => tag.toLowerCase()),
      updatedMs: Date.parse(card.updated_at ?? "") || 0,
    };
  });

  return {
    entries,
    categories: nodes.map((node) => ({
      slug: node.slug,
      name: node.name,
      parent_slug: parentBySlug.get(node.slug) ?? null,
    })),
    branchOf,
    collectionTitles,
    builtAt: Date.now(),
  };
}

async function getIndex(): Promise<CatalogueIndex> {
  if (indexCache && Date.now() - indexCache.builtAt < INDEX_TTL_MS) return indexCache;
  if (!indexPromise) {
    indexPromise = buildIndex()
      .then((built) => {
        indexCache = built;
        return built;
      })
      .finally(() => {
        indexPromise = null;
      });
  }
  return indexPromise;
}

function scoreEntry(entry: IndexEntry, tokens: string[]): number {
  let score = 0;
  const haystackTokens = entry.haystack.split(" ");
  for (const token of tokens) {
    if (entry.titleLower.startsWith(token)) score += 12;
    else if (entry.titleLower.includes(token)) score += 8;
    if (entry.tagsLower.some((tag) => tag.includes(token))) score += 4;
    if (entry.haystack.includes(token)) score += 3;
    else if (token.length >= 4 && haystackTokens.some((word) => withinOneEdit(word, token))) score += 1;
    else return -1;
  }
  if (entry.card.available_for_sale) score += 1;
  return score;
}

function matches(entry: IndexEntry, input: CatalogueQuery, branch: string[] | null): boolean {
  if (branch && (!entry.categorySlug || !branch.includes(entry.categorySlug))) return false;
  if (input.collectionHandle && !entry.collections.includes(input.collectionHandle)) return false;
  if (input.tag && !entry.tagsLower.includes(input.tag.toLowerCase())) return false;
  if (input.availableOnly && entry.card.available_for_sale === false) return false;
  const price = entry.card.price_min;
  if (typeof input.priceMin === "number" && (price ?? Infinity) < input.priceMin) return false;
  if (typeof input.priceMax === "number" && (price ?? Infinity) > input.priceMax) return false;
  return true;
}

function facetsFor(pool: IndexEntry[], index: CatalogueIndex): CatalogueFacets {
  const direct = new Map<string, number>();
  const tagCounts = new Map<string, number>();
  const collectionCounts = new Map<string, number>();
  let available = 0;
  let priceMin: number | null = null;
  let priceMax: number | null = null;
  let currency: string | null = null;

  for (const entry of pool) {
    if (entry.categorySlug) direct.set(entry.categorySlug, (direct.get(entry.categorySlug) ?? 0) + 1);
    for (const tag of entry.card.tags) {
      const key = tag.trim();
      if (key) tagCounts.set(key, (tagCounts.get(key) ?? 0) + 1);
    }
    for (const handle of entry.collections) {
      collectionCounts.set(handle, (collectionCounts.get(handle) ?? 0) + 1);
    }
    if (entry.card.available_for_sale) available += 1;
    if (typeof entry.card.price_min === "number") {
      priceMin = priceMin === null ? entry.card.price_min : Math.min(priceMin, entry.card.price_min);
    }
    if (typeof entry.card.price_max === "number") {
      priceMax = priceMax === null ? entry.card.price_max : Math.max(priceMax, entry.card.price_max);
    }
    if (!currency && entry.card.currency) currency = entry.card.currency;
  }

  const categories = index.categories
    .map((node) => ({
      ...node,
      products: (index.branchOf.get(node.slug) ?? [node.slug]).reduce(
        (sum, slug) => sum + (direct.get(slug) ?? 0),
        0,
      ),
    }))
    .filter((node) => node.products > 0)
    .sort((a, b) => b.products - a.products || a.name.localeCompare(b.name));

  return {
    categories,
    tags: [...tagCounts.entries()]
      .filter(([, hits]) => hits > 1)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 24)
      .map(([tag, products]) => ({ tag, products })),
    collections: [...collectionCounts.entries()]
      .map(([handle, products]) => ({
        handle,
        title: index.collectionTitles.get(handle) ?? handle,
        products,
      }))
      .sort((a, b) => b.products - a.products || a.title.localeCompare(b.title)),
    price: { min: priceMin, max: priceMax, currency },
    available,
    total: pool.length,
  };
}

function sortEntries(
  pool: Array<{ entry: IndexEntry; score: number }>,
  sort: CatalogueSort,
): Array<{ entry: IndexEntry; score: number }> {
  const byTitle = (a: IndexEntry, b: IndexEntry) => a.card.title.localeCompare(b.card.title);
  const sorted = [...pool];
  switch (sort) {
    case "relevance":
      sorted.sort((a, b) => b.score - a.score || byTitle(a.entry, b.entry));
      break;
    case "price_asc":
      sorted.sort(
        (a, b) => (a.entry.card.price_min ?? Infinity) - (b.entry.card.price_min ?? Infinity) || byTitle(a.entry, b.entry),
      );
      break;
    case "price_desc":
      sorted.sort(
        (a, b) => (b.entry.card.price_max ?? -Infinity) - (a.entry.card.price_max ?? -Infinity) || byTitle(a.entry, b.entry),
      );
      break;
    case "newest":
      sorted.sort((a, b) => b.entry.updatedMs - a.entry.updatedMs || byTitle(a.entry, b.entry));
      break;
    case "title_desc":
      sorted.sort((a, b) => byTitle(b.entry, a.entry));
      break;
    default:
      sorted.sort((a, b) => byTitle(a.entry, b.entry));
  }
  return sorted;
}

/** Deterministic catalogue search over canonical public products only. */
export async function searchCatalogue(input: CatalogueQuery): Promise<CatalogueSearchResult> {
  const index = await getIndex();
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 24), 1), 96);
  const offset = Math.max(Math.trunc(input.offset ?? 0), 0);
  const branch = input.category ? (index.branchOf.get(input.category) ?? []) : null;

  const constrained = index.entries.filter((entry) => matches(entry, input, branch));
  const facets = facetsFor(constrained, index);

  const rawTerm = (input.query ?? "").trim();
  let tokens = tokenise(rawTerm);
  let scored = tokens.length
    ? constrained
        .map((entry) => ({ entry, score: scoreEntry(entry, tokens) }))
        .filter((row) => row.score >= 0)
    : constrained.map((entry) => ({ entry, score: 0 }));

  let correctedQuery: string | null = null;
  if (tokens.length > 1 && scored.length === 0) {
    // Fall back to the strongest single token rather than showing nothing.
    const best = [...tokens].sort((a, b) => b.length - a.length)[0]!;
    const relaxed = constrained
      .map((entry) => ({ entry, score: scoreEntry(entry, [best]) }))
      .filter((row) => row.score >= 0);
    if (relaxed.length > 0) {
      scored = relaxed;
      tokens = [best];
      correctedQuery = best;
    }
  }

  const sort = input.sort ?? (rawTerm ? "relevance" : "featured");
  const sorted = sortEntries(scored, sort);
  const page = sorted.slice(offset, offset + limit).map((row) => row.entry.card);

  return {
    items: page,
    total: sorted.length,
    hasMore: offset + page.length < sorted.length,
    facets: { ...facets, total: sorted.length },
    correctedQuery,
  };
}

export interface CatalogueSuggestion {
  type: "product" | "category" | "tag";
  label: string;
  /** Handle for products, slug for categories, raw value for tags. */
  value: string;
}

/** Autocomplete built from deterministic catalogue values only. */
export async function suggestCatalogue(
  term: string,
  limit = 8,
): Promise<CatalogueSuggestion[]> {
  const tokens = tokenise(term);
  if (tokens.length === 0) return [];
  const index = await getIndex();
  const out: CatalogueSuggestion[] = [];

  const products = index.entries
    .map((entry) => ({ entry, score: scoreEntry(entry, tokens) }))
    .filter((row) => row.score >= 0)
    .sort((a, b) => b.score - a.score || a.entry.card.title.localeCompare(b.entry.card.title))
    .slice(0, limit);
  for (const row of products) {
    out.push({ type: "product", label: row.entry.card.title, value: row.entry.card.handle });
  }

  const seenCategory = new Set<string>();
  for (const entry of index.entries) {
    if (!entry.categorySlug || seenCategory.has(entry.categorySlug)) continue;
    const name = entry.card.category_name;
    if (!name) continue;
    if (tokens.every((token) => normalise(name).includes(token))) {
      seenCategory.add(entry.categorySlug);
      out.push({ type: "category", label: name, value: entry.categorySlug });
    }
  }

  const seenTag = new Set<string>();
  for (const entry of index.entries) {
    for (const tag of entry.card.tags) {
      const key = tag.toLowerCase();
      if (seenTag.has(key)) continue;
      if (tokens.every((token) => key.includes(token))) {
        seenTag.add(key);
        out.push({ type: "tag", label: tag, value: tag });
      }
    }
  }

  return out.slice(0, limit + 6);
}
