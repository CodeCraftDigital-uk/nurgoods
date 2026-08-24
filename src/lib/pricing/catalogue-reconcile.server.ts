/**
 * Live catalogue reconciliation.
 *
 * The store is the commercial system of record. The local mirror is only ever
 * a copy of it, and a copy can go stale: products drafted directly in the
 * admin, prices corrected by hand, variants removed. When that happens the
 * mirror lies, and anything that scopes work from the mirror inherits the lie.
 * That is exactly how a repair walk can decide there is nothing to do while
 * the whole catalogue is sitting in draft, and how the public projection can
 * keep showing a price the store no longer holds.
 *
 * So before any pricing decision is made, the full catalogue is read back from
 * the store and the mirror is rewritten from it: product status, variant
 * prices, compare-at prices and derived price ranges. The public projection is
 * rebuilt afterwards so the website shows what the store actually holds.
 *
 * Nothing here activates, publishes, or changes anything in the store. It is a
 * one directional pull: store -> mirror -> projection.
 */
import { intakeCredentials, shopifyGraphql } from "../services/shopify.server";
import { zendropAdminClient } from "../zendrop/client.server";

/** Bounded page size for the store read. */
const PAGE_SIZE = 50;

/** Upper bound on one reconciliation call. */
const MAX_PAGES = 40;

const CATALOGUE_QUERY = `
  query NurGoodsCatalogueReconcile($cursor: String) {
    products(first: ${PAGE_SIZE}, after: $cursor, sortKey: ID) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        status
        variants(first: 100) {
          nodes { id title price compareAtPrice }
        }
      }
    }
  }
`;

export interface LiveVariant {
  id: string;
  title: string | null;
  price: number | null;
  compareAtPrice: number | null;
}

export interface LiveProduct {
  shopifyProductId: string;
  title: string | null;
  /** Lower case store status: active, draft or archived. */
  status: string;
  variants: LiveVariant[];
}

export interface LiveCataloguePage {
  products: LiveProduct[];
  cursor: string | null;
  hasNextPage: boolean;
}

export interface ReconcileDeps {
  fetchPage(cursor: string | null): Promise<LiveCataloguePage>;
  /** Rewrites the mirror rows for one product from the live product. */
  writeProduct(product: LiveProduct): Promise<void>;
  /** Rebuilds the public storefront projection from the corrected mirror. */
  refreshProjection(): Promise<void>;
}

export interface ReconcileReport {
  products: number;
  variants: number;
  active: number;
  draft: number;
  archived: number;
  pages: number;
  finished: boolean;
  projectionRefreshed: boolean;
  message: string;
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Walks the whole live catalogue and rewrites the mirror from it, then rebuilds
 * the public projection. Injected dependencies so the behaviour can be proven
 * without a store.
 */
export async function reconcileCatalogueWith(
  deps: ReconcileDeps,
  options: { maxPages?: number } = {},
): Promise<ReconcileReport> {
  const maxPages = Math.max(1, Math.min(options.maxPages ?? MAX_PAGES, MAX_PAGES));
  const report: ReconcileReport = {
    products: 0,
    variants: 0,
    active: 0,
    draft: 0,
    archived: 0,
    pages: 0,
    finished: false,
    projectionRefreshed: false,
    message: "",
  };

  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const result: LiveCataloguePage = await deps.fetchPage(cursor);
    report.pages += 1;
    for (const product of result.products) {
      await deps.writeProduct(product);
      report.products += 1;
      report.variants += product.variants.length;
      if (product.status === "active") report.active += 1;
      else if (product.status === "draft") report.draft += 1;
      else if (product.status === "archived") report.archived += 1;
    }
    cursor = result.cursor;
    if (!result.hasNextPage) {
      report.finished = true;
      break;
    }
  }

  // The projection is only ever rebuilt from a corrected mirror, so a partial
  // walk does not get to publish a half reconciled catalogue.
  if (report.finished) {
    await deps.refreshProjection();
    report.projectionRefreshed = true;
  }

  report.message =
    `Reconciled ${report.products} store product(s) and ${report.variants} variant(s) into the mirror: ` +
    `${report.active} active, ${report.draft} draft, ${report.archived} archived. ` +
    (report.finished
      ? `The projection was rebuilt from the corrected mirror.`
      : `The walk did not reach the end of the catalogue, so the projection was left alone.`) +
    " No store product was changed.";
  return report;
}

/** Reads one page of the live catalogue from the store. */
export async function fetchLiveCataloguePage(cursor: string | null): Promise<LiveCataloguePage> {
  const credentials = await intakeCredentials();
  const data: any = await shopifyGraphql(credentials, CATALOGUE_QUERY, { cursor });
  const connection = data?.products;
  const products: LiveProduct[] = ((connection?.nodes ?? []) as any[])
    .filter((node) => node?.id)
    .map((node) => ({
      shopifyProductId: String(node.id),
      title: node.title ? String(node.title) : null,
      status: String(node.status ?? "").toLowerCase(),
      variants: ((node.variants?.nodes ?? []) as any[]).map((variant) => ({
        id: String(variant.id),
        title: variant.title ? String(variant.title) : null,
        price: numeric(variant.price),
        compareAtPrice: numeric(variant.compareAtPrice),
      })),
    }));
  return {
    products,
    cursor: connection?.pageInfo?.endCursor ?? null,
    hasNextPage: Boolean(connection?.pageInfo?.hasNextPage),
  };
}

/** The real adapter: store read, mirror write, projection rebuild. */
async function liveReconcileDeps(): Promise<ReconcileDeps> {
  const supabase = await zendropAdminClient();
  return {
    fetchPage: (cursor) => fetchLiveCataloguePage(cursor),
    async writeProduct(product) {
      const now = new Date().toISOString();
      const { data: mirror } = await supabase
        .from("shopify_products")
        .select("id")
        .eq("shopify_product_id", product.shopifyProductId)
        .maybeSingle();
      const mirrorId = (mirror as any)?.id ?? null;

      for (const variant of product.variants) {
        await supabase
          .from("shopify_product_variants")
          .update({ price: variant.price, compare_at_price: variant.compareAtPrice } as never)
          .eq("shopify_variant_id", variant.id);
      }

      if (!mirrorId) return;
      const prices = product.variants
        .map((variant) => variant.price)
        .filter((value): value is number => value !== null);
      await supabase
        .from("shopify_products")
        .update({
          status: product.status,
          price_min: prices.length > 0 ? Math.min(...prices) : null,
          price_max: prices.length > 0 ? Math.max(...prices) : null,
          last_synced_at: now,
        } as never)
        .eq("id", mirrorId);
    },
    async refreshProjection() {
      const { refreshStorefrontSnapshot } = await import("../automation/snapshot.server");
      await refreshStorefrontSnapshot(supabase, "pricing_catalogue_reconcile");
    },
  };
}

/**
 * Pulls the full live catalogue into the mirror and rebuilds the public
 * projection. Read only against the store.
 */
export async function reconcileLiveCatalogue(
  options: { maxPages?: number } = {},
): Promise<ReconcileReport> {
  return reconcileCatalogueWith(await liveReconcileDeps(), options);
}

/**
 * Selects the product ids a backfill pass should work on, from the LIVE store
 * catalogue only. The mirror's opinion of a product's status is deliberately
 * not consulted: a stale mirror row saying "active" must never hide a product
 * the store is currently holding as a draft.
 */
export function selectBackfillProductIds(
  live: Array<{ shopifyProductId: string; status: string }>,
  options: { scope: "draft" | "all"; cursor: string; limit: number },
): string[] {
  return live
    .filter((product) => product.shopifyProductId > options.cursor)
    .filter((product) =>
      options.scope === "all" ? true : String(product.status).toLowerCase() === "draft",
    )
    .map((product) => product.shopifyProductId)
    .sort()
    .slice(0, Math.max(1, options.limit));
}

/**
 * Lists the next page of live product ids for the backfill walk, scoped by the
 * status the store reports right now.
 */
export async function listLiveProductIds(
  cursor: string,
  limit: number,
  scope: "draft" | "all",
): Promise<string[]> {
  const collected: string[] = [];
  let pageCursor: string | null = null;
  for (let page = 0; page < MAX_PAGES && collected.length < limit; page += 1) {
    const result: LiveCataloguePage = await fetchLiveCataloguePage(pageCursor);
    collected.push(
      ...selectBackfillProductIds(result.products, {
        scope,
        cursor,
        limit: limit - collected.length,
      }),
    );
    pageCursor = result.cursor;
    if (!result.hasNextPage) break;
  }
  return collected.sort().slice(0, limit);
}
