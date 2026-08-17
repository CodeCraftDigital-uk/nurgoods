import { supabase } from "@/integrations/supabase/client";
import type {
  ProductEnrichment,
  ShopifyCollection,
  ShopifyProduct,
} from "@/lib/types/platform";

/**
 * Read-only mirrors of the Shopify catalogue. Rows are only ever written by the
 * future Shopify Admin API sync. Nothing here is authoritative.
 */
/**
 * Admin catalogue columns. The raw supplier sync payload is deliberately not
 * requested: it is internal integration data and is not readable from the
 * browser session.
 */
const ADMIN_PRODUCT_COLUMNS =
  "id, shopify_product_id, handle, title, product_type, vendor, status, tags, featured_image_url, price_min, price_max, currency, variant_count, shopify_updated_at, sync_status, last_synced_at, created_at, updated_at, description, description_html, seo_title, seo_description, online_store_url, compare_at_price_min, compare_at_price_max, available_for_sale, total_inventory, options";

export async function listProducts(): Promise<ShopifyProduct[]> {
  const { data, error } = await supabase
    .from("shopify_products")
    .select(ADMIN_PRODUCT_COLUMNS)
    .order("title", { ascending: true });
  if (error) throw error;
  return data as unknown as ShopifyProduct[];
}

export async function listCollections(): Promise<ShopifyCollection[]> {
  const { data, error } = await supabase
    .from("shopify_collections")
    .select("*")
    .order("title", { ascending: true });
  if (error) throw error;
  return data;
}

export async function listEnrichment(): Promise<ProductEnrichment[]> {
  const { data, error } = await supabase
    .from("product_enrichment")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data;
}

export interface CatalogueSummary {
  products: number;
  collections: number;
  enriched: number;
  lastSyncedAt: string | null;
}

export async function getCatalogueSummary(): Promise<CatalogueSummary> {
  const [products, collections, enrichment] = await Promise.all([
    listProducts(),
    listCollections(),
    listEnrichment(),
  ]);
  const timestamps = products
    .map((p) => p.last_synced_at)
    .filter((value): value is string => Boolean(value))
    .sort();
  return {
    products: products.length,
    collections: collections.length,
    enriched: enrichment.filter((e) => e.status === "published").length,
    lastSyncedAt: timestamps.at(-1) ?? null,
  };
}
