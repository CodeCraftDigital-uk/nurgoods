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
export async function listProducts(): Promise<ShopifyProduct[]> {
  const { data, error } = await supabase
    .from("shopify_products")
    .select("*")
    .order("title", { ascending: true });
  if (error) throw error;
  return data;
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
