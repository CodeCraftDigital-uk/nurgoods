import type { SupabaseClient } from "@supabase/supabase-js";

export interface ShopifyCredentialStatus {
  configured: boolean;
  shopDomain: string | null;
  apiVersion: string;
  missing: string[];
}

export const SHOPIFY_SECRET_NAMES = {
  shopDomain: "SHOPIFY_SHOP_DOMAIN",
  adminToken: "SHOPIFY_ADMIN_API_TOKEN",
  apiVersion: "SHOPIFY_API_VERSION",
} as const;

const DEFAULT_API_VERSION = "2024-10";

export function readShopifyCredentials(): {
  shopDomain: string | null;
  adminToken: string | null;
  apiVersion: string;
  missing: string[];
} {
  const shopDomain = process.env[SHOPIFY_SECRET_NAMES.shopDomain]?.trim() || null;
  const adminToken = process.env[SHOPIFY_SECRET_NAMES.adminToken]?.trim() || null;
  const apiVersion = process.env[SHOPIFY_SECRET_NAMES.apiVersion]?.trim() || DEFAULT_API_VERSION;

  const missing: string[] = [];
  if (!shopDomain) missing.push(SHOPIFY_SECRET_NAMES.shopDomain);
  if (!adminToken) missing.push(SHOPIFY_SECRET_NAMES.adminToken);

  return { shopDomain, adminToken, apiVersion, missing };
}

const CATALOGUE_QUERY = /* GraphQL */ `
  query NurGoodsCatalogue($productCursor: String, $collectionCursor: String) {
    products(first: 50, after: $productCursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        handle
        status
        productType
        tags
        updatedAt
        featuredImage {
          url
        }
        priceRangeV2 {
          minVariantPrice {
            amount
            currencyCode
          }
          maxVariantPrice {
            amount
          }
        }
        variants(first: 1) {
          pageInfo {
            hasNextPage
          }
        }
        variantsCount {
          count
        }
      }
    }
    collections(first: 50, after: $collectionCursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        handle
        description
        updatedAt
        productsCount {
          count
        }
        image {
          url
        }
      }
    }
  }
`;

type GraphQlProduct = {
  id: string;
  title: string;
  handle: string;
  status: string | null;
  productType: string | null;
  tags: string[] | null;
  updatedAt: string | null;
  featuredImage: { url: string } | null;
  priceRangeV2: {
    minVariantPrice: { amount: string; currencyCode: string } | null;
    maxVariantPrice: { amount: string } | null;
  } | null;
  variantsCount: { count: number } | null;
};

type GraphQlCollection = {
  id: string;
  title: string;
  handle: string;
  description: string | null;
  updatedAt: string | null;
  productsCount: { count: number } | null;
  image: { url: string } | null;
};

async function fetchCatalogue(
  shopDomain: string,
  adminToken: string,
  apiVersion: string,
): Promise<{ products: GraphQlProduct[]; collections: GraphQlCollection[] }> {
  const products: GraphQlProduct[] = [];
  const collections: GraphQlCollection[] = [];
  let productCursor: string | null = null;
  let collectionCursor: string | null = null;
  let more = true;
  let pages = 0;

  while (more && pages < 20) {
    const response = await fetch(`https://${shopDomain}/admin/api/${apiVersion}/graphql.json`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Shopify-Access-Token": adminToken,
      },
      body: JSON.stringify({
        query: CATALOGUE_QUERY,
        variables: { productCursor, collectionCursor },
      }),
    });

    if (!response.ok) {
      throw new Error(`Shopify Admin API responded with ${response.status}`);
    }

    const payload = (await response.json()) as {
      data?: {
        products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: GraphQlProduct[] };
        collections: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: GraphQlCollection[];
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (payload.errors?.length) {
      throw new Error(payload.errors.map((e) => e.message).join("; "));
    }
    if (!payload.data) throw new Error("Shopify Admin API returned no data");

    products.push(...payload.data.products.nodes);
    collections.push(...payload.data.collections.nodes);

    const productsNext = payload.data.products.pageInfo.hasNextPage;
    const collectionsNext = payload.data.collections.pageInfo.hasNextPage;
    productCursor = productsNext ? payload.data.products.pageInfo.endCursor : productCursor;
    collectionCursor = collectionsNext
      ? payload.data.collections.pageInfo.endCursor
      : collectionCursor;
    more = productsNext || collectionsNext;
    pages += 1;
  }

  return { products, collections };
}

function toNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface SyncResult {
  products: number;
  collections: number;
  syncedAt: string;
}

export async function syncCatalogue(
  supabase: SupabaseClient<any, "public", any>,
): Promise<SyncResult> {
  const { shopDomain, adminToken, apiVersion, missing } = readShopifyCredentials();
  if (!shopDomain || !adminToken) {
    throw new Error(`Shopify credentials missing: ${missing.join(", ")}`);
  }

  const syncedAt = new Date().toISOString();
  const { products, collections } = await fetchCatalogue(shopDomain, adminToken, apiVersion);

  if (products.length > 0) {
    const rows = products.map((product) => ({
      shopify_product_id: product.id,
      title: product.title,
      handle: product.handle,
      status: product.status,
      product_type: product.productType,
      tags: product.tags ?? [],
      featured_image_url: product.featuredImage?.url ?? null,
      currency: product.priceRangeV2?.minVariantPrice?.currencyCode ?? null,
      price_min: toNumber(product.priceRangeV2?.minVariantPrice?.amount),
      price_max: toNumber(product.priceRangeV2?.maxVariantPrice?.amount),
      variant_count: product.variantsCount?.count ?? 0,
      shopify_updated_at: product.updatedAt,
      sync_status: "synced" as const,
      last_synced_at: syncedAt,
      raw: product as unknown as Record<string, unknown>,
    }));
    const { error } = await supabase
      .from("shopify_products")
      .upsert(rows, { onConflict: "shopify_product_id" });
    if (error) throw new Error(error.message);
  }

  if (collections.length > 0) {
    const rows = collections.map((collection) => ({
      shopify_collection_id: collection.id,
      title: collection.title,
      handle: collection.handle,
      description: collection.description,
      image_url: collection.image?.url ?? null,
      product_count: collection.productsCount?.count ?? 0,
      shopify_updated_at: collection.updatedAt,
      sync_status: "synced" as const,
      last_synced_at: syncedAt,
      raw: collection as unknown as Record<string, unknown>,
    }));
    const { error } = await supabase
      .from("shopify_collections")
      .upsert(rows, { onConflict: "shopify_collection_id" });
    if (error) throw new Error(error.message);
  }

  return { products: products.length, collections: collections.length, syncedAt };
}

export async function recordSyncEvent(
  supabase: SupabaseClient<any, "public", any>,
  input: { status: "success" | "failed"; message: string; payload?: Record<string, unknown> },
): Promise<void> {
  const { data: integration } = await supabase
    .from("integrations")
    .select("id")
    .eq("provider", "shopify")
    .maybeSingle();

  await supabase.from("integration_events").insert({
    integration_id: integration?.id ?? null,
    event_type: "catalogue_sync",
    status: input.status,
    message: input.message,
    payload: input.payload ?? {},
  });

  if (integration?.id) {
    await supabase
      .from("integrations")
      .update({ status: input.status === "success" ? "connected" : "error" })
      .eq("id", integration.id);
  }
}
