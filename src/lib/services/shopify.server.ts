/**
 * Store connection service.
 *
 * Credentials come from the admin panel first (shop domain and API version in
 * integration_settings, Admin API token in the encrypted vault) and fall back
 * to server environment variables for backwards compatibility. The token is
 * never returned to the browser and never written to an event payload.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ShopifyCredentialStatus {
  configured: boolean;
  shopDomain: string | null;
  apiVersion: string;
  missing: string[];
  source: "database" | "environment" | "none";
  hasStoredToken: boolean;
  connectionState: "not_connected" | "connected" | "error";
  lastTestedAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  shopName: string | null;
}

export const SHOPIFY_SECRET_NAMES = {
  shopDomain: "SHOPIFY_SHOP_DOMAIN",
  adminToken: "SHOPIFY_ADMIN_API_TOKEN",
  apiVersion: "SHOPIFY_API_VERSION",
} as const;

/** Vault secret name for the Admin API access token. */
export const SHOPIFY_VAULT_SECRET = "shopify_admin_api_token";

export const DEFAULT_API_VERSION = "2026-07";

const SETTING_KEYS = {
  shopDomain: "shop_domain",
  apiVersion: "api_version",
  adminToken: "admin_api_token",
  connectionState: "connection_state",
  lastTestedAt: "last_tested_at",
  lastSyncedAt: "last_synced_at",
  lastError: "last_error",
  shopName: "shop_name",
} as const;

/** Accepts a domain, a URL or a pasted admin link and returns the bare host. */
export function normaliseShopDomain(input: string): string {
  let value = (input ?? "").trim().toLowerCase();
  if (!value) throw new Error("A shop domain is required");
  value = value.replace(/^https?:\/\//, "");
  value = value.split("/")[0]!;
  value = value.split("?")[0]!;
  value = value.replace(/\.$/, "");
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(value) || value.includes("..")) {
    throw new Error("That does not look like a valid shop domain");
  }
  return value;
}

export function normaliseApiVersion(input: string | null | undefined): string {
  const value = (input ?? "").trim();
  if (!value) return DEFAULT_API_VERSION;
  if (!/^\d{4}-\d{2}$/.test(value) && value !== "unstable") {
    throw new Error("API version must look like 2026-07");
  }
  return value;
}

/** Legacy synchronous environment read. Kept for backwards compatibility. */
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

type AdminClient = SupabaseClient<any, "public", any>;

async function adminClient(): Promise<AdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as AdminClient;
}

async function integrationId(supabase: AdminClient): Promise<string | null> {
  const { data } = await supabase
    .from("integrations")
    .select("id")
    .eq("provider", "shopify")
    .maybeSingle();
  if ((data as any)?.id) return (data as any).id as string;

  // First pairing on a fresh environment: create the integration record.
  const { data: created } = await supabase
    .from("integrations")
    .upsert({ provider: "shopify", label: "Shopify", status: "not_connected" }, { onConflict: "provider" })
    .select("id")
    .maybeSingle();
  return (created as any)?.id ?? null;
}


async function readSettings(supabase: AdminClient): Promise<Map<string, string | null>> {
  const id = await integrationId(supabase);
  const map = new Map<string, string | null>();
  if (!id) return map;
  const { data } = await supabase
    .from("integration_settings")
    .select("key, value")
    .eq("integration_id", id);
  for (const row of (data ?? []) as any[]) map.set(row.key, row.value ?? null);
  return map;
}

async function writeSetting(
  supabase: AdminClient,
  key: string,
  label: string,
  value: string | null,
  options: { isSecretReference?: boolean; secretName?: string | null; helpText?: string | null } = {},
): Promise<void> {
  const id = await integrationId(supabase);
  if (!id) throw new Error("The store integration record is missing");
  await supabase.from("integration_settings").upsert(
    {
      integration_id: id,
      key,
      label,
      value,
      is_secret_reference: options.isSecretReference ?? false,
      secret_name: options.secretName ?? null,
      help_text: options.helpText ?? null,
    },
    { onConflict: "integration_id,key" },
  );
}

export interface ResolvedCredentials {
  shopDomain: string | null;
  adminToken: string | null;
  apiVersion: string;
  missing: string[];
  source: "database" | "environment" | "none";
  hasStoredToken: boolean;
}

/** Database configured credentials win over environment values. */
export async function resolveShopifyCredentials(): Promise<ResolvedCredentials> {
  const env = readShopifyCredentials();
  let dbDomain: string | null = null;
  let dbVersion: string | null = null;
  let dbToken: string | null = null;

  try {
    const supabase = await adminClient();
    const settings = await readSettings(supabase);
    dbDomain = settings.get(SETTING_KEYS.shopDomain) ?? null;
    dbVersion = settings.get(SETTING_KEYS.apiVersion) ?? null;
    const { data } = await supabase.rpc("get_integration_secret", {
      _name: SHOPIFY_VAULT_SECRET,
    });
    dbToken = typeof data === "string" && data.trim() ? data.trim() : null;
  } catch {
    // Vault or settings unavailable. Environment fallback still applies.
  }

  const shopDomain = dbDomain || env.shopDomain;
  const adminToken = dbToken || env.adminToken;
  const apiVersion = dbVersion || env.apiVersion || DEFAULT_API_VERSION;

  const missing: string[] = [];
  if (!shopDomain) missing.push("Shop domain");
  if (!adminToken) missing.push("Admin API access token");

  const source: ResolvedCredentials["source"] =
    dbDomain && dbToken ? "database" : shopDomain && adminToken ? "environment" : "none";

  return {
    shopDomain,
    adminToken,
    apiVersion,
    missing,
    source,
    hasStoredToken: Boolean(dbToken),
  };
}

export async function getShopifyCredentialStatus(): Promise<ShopifyCredentialStatus> {
  const resolved = await resolveShopifyCredentials();
  let settings = new Map<string, string | null>();
  try {
    settings = await readSettings(await adminClient());
  } catch {
    /* settings unavailable */
  }
  const state = settings.get(SETTING_KEYS.connectionState) ?? null;
  return {
    configured: resolved.missing.length === 0,
    shopDomain: resolved.shopDomain,
    apiVersion: resolved.apiVersion,
    missing: resolved.missing,
    source: resolved.source,
    hasStoredToken: resolved.hasStoredToken,
    connectionState:
      state === "connected" || state === "error"
        ? state
        : resolved.missing.length === 0
          ? "connected"
          : "not_connected",
    lastTestedAt: settings.get(SETTING_KEYS.lastTestedAt) ?? null,
    lastSyncedAt: settings.get(SETTING_KEYS.lastSyncedAt) ?? null,
    lastError: settings.get(SETTING_KEYS.lastError) ?? null,
    shopName: settings.get(SETTING_KEYS.shopName) ?? null,
  };
}

/* ---------------------------- GraphQL client ---------------------------- */

/**
 * Describes what a token looks like without ever revealing it. Only the public
 * Shopify prefix convention is used, never the secret body of the value.
 */
function describeTokenShape(token: string): string | null {
  const value = (token ?? "").trim();
  if (!value) return "No token was supplied.";
  if (value.startsWith("shpss_")) {
    return "That value is the custom app API secret key, not the Admin API access token. Copy the token that begins with shpat_.";
  }
  if (value.startsWith("shpca_")) {
    return "That value is the custom app client ID, not the Admin API access token. Copy the token that begins with shpat_.";
  }
  if (/^[0-9a-f]{32}$/i.test(value)) {
    return "That value looks like a Storefront API token or API key, not an Admin API access token. Copy the token that begins with shpat_.";
  }
  if (!value.startsWith("shpat_") && !value.startsWith("shpua_")) {
    return "That value does not look like a Shopify Admin API access token. It should begin with shpat_.";
  }
  return null;
}

async function graphql<T>(
  credentials: { shopDomain: string; adminToken: string; apiVersion: string },
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const shapeIssue = describeTokenShape(credentials.adminToken);
  if (shapeIssue) throw new Error(shapeIssue);

  const response = await fetch(
    `https://${credentials.shopDomain}/admin/api/${credentials.apiVersion}/graphql.json`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Shopify-Access-Token": credentials.adminToken,
      },
      body: JSON.stringify({ query, variables }),
    },
  );

  if (response.status === 401) {
    throw new Error(
      `The store at ${credentials.shopDomain} rejected the Admin API access token (401). The token is invalid, revoked, or belongs to a different store. Reinstall the custom app on this store and paste the freshly revealed Admin API access token beginning with shpat_.`,
    );
  }
  if (response.status === 403) {
    throw new Error(
      "The token was accepted but the custom app is missing Admin API scopes (403). Enable read_products, read_inventory and read_locations, save, then reinstall the app and use the new token.",
    );
  }
  if (response.status === 404) {
    throw new Error(
      `No Admin API was found at ${credentials.shopDomain} for version ${credentials.apiVersion}. Check the .myshopify.com domain and the API version.`,
    );
  }
  if (response.status === 402) {
    throw new Error("The store is frozen or unavailable for API access (402). Check the store status in Shopify admin.");
  }
  if (response.status === 423) {
    throw new Error("The store is locked (423) and cannot serve Admin API requests.");
  }
  if (!response.ok) {
    throw new Error(`The store responded with ${response.status}`);
  }


  const payload = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (payload.errors?.length) throw new Error(payload.errors.map((e) => e.message).join("; "));
  if (!payload.data) throw new Error("The store returned no data");
  return payload.data;
}

const SHOP_QUERY = /* GraphQL */ `
  query NurGoodsShop {
    shop {
      name
      myshopifyDomain
      primaryDomain {
        host
      }
      currencyCode
      ianaTimezone
    }
  }
`;

export interface ConnectionTestResult {
  ok: true;
  shopName: string;
  myshopifyDomain: string;
  primaryDomain: string | null;
  currency: string | null;
  apiVersion: string;
}

export async function testShopifyConnection(input: {
  shopDomain: string;
  adminToken: string;
  apiVersion: string;
}): Promise<ConnectionTestResult> {
  const data = await graphql<{
    shop: {
      name: string;
      myshopifyDomain: string;
      primaryDomain: { host: string } | null;
      currencyCode: string | null;
    };
  }>(input, SHOP_QUERY);

  return {
    ok: true,
    shopName: data.shop.name,
    myshopifyDomain: data.shop.myshopifyDomain,
    primaryDomain: data.shop.primaryDomain?.host ?? null,
    currency: data.shop.currencyCode ?? null,
    apiVersion: input.apiVersion,
  };
}

/* --------------------------- credential writes -------------------------- */

export async function saveShopifyCredentials(input: {
  shopDomain: string;
  apiVersion: string;
  adminToken?: string | null;
  shopName?: string | null;
}): Promise<void> {
  const supabase = await adminClient();
  if (input.adminToken) {
    const { error } = await supabase.rpc("set_integration_secret", {
      _name: SHOPIFY_VAULT_SECRET,
      _secret: input.adminToken,
    });
    if (error) throw new Error("The access token could not be stored securely");
  }
  await writeSetting(supabase, SETTING_KEYS.shopDomain, "Shop domain", input.shopDomain);
  await writeSetting(supabase, SETTING_KEYS.apiVersion, "Admin API version", input.apiVersion);
  await writeSetting(supabase, SETTING_KEYS.adminToken, "Admin API access token", null, {
    isSecretReference: true,
    secretName: SHOPIFY_VAULT_SECRET,
    helpText: "Stored in the encrypted vault. It is never sent back to the browser.",
  });
  if (input.shopName) {
    await writeSetting(supabase, SETTING_KEYS.shopName, "Store name", input.shopName);
  }
}

export async function markConnectionState(input: {
  state: "connected" | "error" | "not_connected";
  error?: string | null;
  testedAt?: string | null;
  syncedAt?: string | null;
}): Promise<void> {
  const supabase = await adminClient();
  await writeSetting(supabase, SETTING_KEYS.connectionState, "Connection state", input.state);
  await writeSetting(supabase, SETTING_KEYS.lastError, "Last error", input.error ?? null);
  if (input.testedAt) {
    await writeSetting(supabase, SETTING_KEYS.lastTestedAt, "Last tested", input.testedAt);
  }
  if (input.syncedAt) {
    await writeSetting(supabase, SETTING_KEYS.lastSyncedAt, "Last successful sync", input.syncedAt);
  }
  const id = await integrationId(supabase);
  if (id) {
    await supabase
      .from("integrations")
      .update({ status: input.state === "connected" ? "connected" : input.state === "error" ? "error" : "not_connected" })
      .eq("id", id);
  }
}

export async function disconnectShopify(): Promise<void> {
  const supabase = await adminClient();
  await supabase.rpc("delete_integration_secret", { _name: SHOPIFY_VAULT_SECRET });
  const id = await integrationId(supabase);
  if (id) {
    await supabase
      .from("integration_settings")
      .delete()
      .eq("integration_id", id)
      .in("key", [
        SETTING_KEYS.shopDomain,
        SETTING_KEYS.apiVersion,
        SETTING_KEYS.adminToken,
        SETTING_KEYS.shopName,
        SETTING_KEYS.lastTestedAt,
        SETTING_KEYS.lastSyncedAt,
        SETTING_KEYS.lastError,
      ]);
  }
  await markConnectionState({ state: "not_connected", error: null });
}

/* ------------------------------ catalogue ------------------------------ */

const CATALOGUE_QUERY = /* GraphQL */ `
  query NurGoodsCatalogue($productCursor: String) {
    products(first: 25, after: $productCursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        handle
        status
        vendor
        productType
        tags
        description
        descriptionHtml
        onlineStoreUrl
        totalInventory
        updatedAt
        seo {
          title
          description
        }
        options {
          name
          values
        }
        featuredMedia {
          preview {
            image {
              url
            }
          }
        }
        media(first: 12) {
          nodes {
            id
            mediaContentType
            alt
            preview {
              image {
                url
                width
                height
              }
            }
          }
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
        compareAtPriceRange {
          minVariantCompareAtPrice {
            amount
          }
          maxVariantCompareAtPrice {
            amount
          }
        }
        variantsCount {
          count
        }
        variants(first: 50) {
          nodes {
            id
            title
            sku
            price
            compareAtPrice
            availableForSale
            inventoryQuantity
            updatedAt
            selectedOptions {
              name
              value
            }
            image {
              url
            }
          }
        }
        collections(first: 20) {
          nodes {
            id
          }
        }
      }
    }
  }
`;

const COLLECTIONS_QUERY = /* GraphQL */ `
  query NurGoodsCollections($cursor: String) {
    collections(first: 50, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        handle
        description
        descriptionHtml
        updatedAt
        seo {
          title
          description
        }
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
  vendor: string | null;
  productType: string | null;
  tags: string[] | null;
  description: string | null;
  descriptionHtml: string | null;
  onlineStoreUrl: string | null;
  totalInventory: number | null;
  updatedAt: string | null;
  seo: { title: string | null; description: string | null } | null;
  options: Array<{ name: string; values: string[] }> | null;
  featuredMedia: { preview: { image: { url: string } | null } | null } | null;
  media: {
    nodes: Array<{
      id: string;
      mediaContentType: string | null;
      alt: string | null;
      preview: { image: { url: string; width: number | null; height: number | null } | null } | null;
    }>;
  } | null;
  priceRangeV2: {
    minVariantPrice: { amount: string; currencyCode: string } | null;
    maxVariantPrice: { amount: string } | null;
  } | null;
  compareAtPriceRange: {
    minVariantCompareAtPrice: { amount: string } | null;
    maxVariantCompareAtPrice: { amount: string } | null;
  } | null;
  variantsCount: { count: number } | null;
  variants: {
    nodes: Array<{
      id: string;
      title: string;
      sku: string | null;
      price: string | null;
      compareAtPrice: string | null;
      availableForSale: boolean | null;
      inventoryQuantity: number | null;
      updatedAt: string | null;
      selectedOptions: Array<{ name: string; value: string }> | null;
      image: { url: string } | null;
    }>;
  } | null;
  collections: { nodes: Array<{ id: string }> } | null;
};

type GraphQlCollection = {
  id: string;
  title: string;
  handle: string;
  description: string | null;
  descriptionHtml: string | null;
  updatedAt: string | null;
  seo: { title: string | null; description: string | null } | null;
  productsCount: { count: number } | null;
  image: { url: string } | null;
};

function toNumber(value: string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface SyncResult {
  products: number;
  collections: number;
  variants: number;
  media: number;
  syncedAt: string;
}

export async function syncCatalogue(
  supabase: SupabaseClient<any, "public", any>,
): Promise<SyncResult> {
  const resolved = await resolveShopifyCredentials();
  if (!resolved.shopDomain || !resolved.adminToken) {
    throw new Error(`Store credentials missing: ${resolved.missing.join(", ")}`);
  }
  const credentials = {
    shopDomain: resolved.shopDomain,
    adminToken: resolved.adminToken,
    apiVersion: resolved.apiVersion,
  };

  const syncedAt = new Date().toISOString();

  const products: GraphQlProduct[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 40; page += 1) {
    const data: any = await graphql(credentials, CATALOGUE_QUERY, { productCursor: cursor });
    products.push(...(data.products.nodes as GraphQlProduct[]));
    if (!data.products.pageInfo.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
  }

  const collections: GraphQlCollection[] = [];
  cursor = null;
  for (let page = 0; page < 20; page += 1) {
    const data: any = await graphql(credentials, COLLECTIONS_QUERY, { cursor });
    collections.push(...(data.collections.nodes as GraphQlCollection[]));
    if (!data.collections.pageInfo.hasNextPage) break;
    cursor = data.collections.pageInfo.endCursor;
  }

  const collectionIdByShopifyId = new Map<string, string>();
  if (collections.length > 0) {
    const rows = collections.map((collection) => ({
      shopify_collection_id: collection.id,
      title: collection.title,
      handle: collection.handle,
      description: collection.description,
      description_html: collection.descriptionHtml,
      seo_title: collection.seo?.title ?? null,
      seo_description: collection.seo?.description ?? null,
      image_url: collection.image?.url ?? null,
      product_count: collection.productsCount?.count ?? 0,
      shopify_updated_at: collection.updatedAt,
      sync_status: "synced" as const,
      last_synced_at: syncedAt,
      raw: collection as unknown as Record<string, unknown>,
    }));
    const { data, error } = await supabase
      .from("shopify_collections")
      .upsert(rows, { onConflict: "shopify_collection_id" })
      .select("id, shopify_collection_id");
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as any[]) {
      collectionIdByShopifyId.set(row.shopify_collection_id, row.id);
    }
  }

  let variantCount = 0;
  let mediaCount = 0;

  if (products.length > 0) {
    const rows = products.map((product) => ({
      shopify_product_id: product.id,
      title: product.title,
      handle: product.handle,
      status: product.status ? product.status.toLowerCase() : null,
      vendor: product.vendor,
      product_type: product.productType,
      tags: product.tags ?? [],
      description: product.description,
      description_html: product.descriptionHtml,
      seo_title: product.seo?.title ?? null,
      seo_description: product.seo?.description ?? null,
      online_store_url: product.onlineStoreUrl,
      total_inventory: product.totalInventory ?? null,
      available_for_sale: (product.variants?.nodes ?? []).some((v) => v.availableForSale === true),
      options: (product.options ?? []) as unknown as Record<string, unknown>,
      featured_image_url:
        product.featuredMedia?.preview?.image?.url ??
        product.media?.nodes?.[0]?.preview?.image?.url ??
        null,
      currency: product.priceRangeV2?.minVariantPrice?.currencyCode ?? null,
      price_min: toNumber(product.priceRangeV2?.minVariantPrice?.amount),
      price_max: toNumber(product.priceRangeV2?.maxVariantPrice?.amount),
      compare_at_price_min: toNumber(
        product.compareAtPriceRange?.minVariantCompareAtPrice?.amount,
      ),
      compare_at_price_max: toNumber(
        product.compareAtPriceRange?.maxVariantCompareAtPrice?.amount,
      ),
      variant_count: product.variantsCount?.count ?? product.variants?.nodes?.length ?? 0,
      shopify_updated_at: product.updatedAt,
      sync_status: "synced" as const,
      last_synced_at: syncedAt,
      raw: product as unknown as Record<string, unknown>,
    }));

    const { data, error } = await supabase
      .from("shopify_products")
      .upsert(rows, { onConflict: "shopify_product_id" })
      .select("id, shopify_product_id");
    if (error) throw new Error(error.message);

    const productIdByShopifyId = new Map<string, string>();
    for (const row of (data ?? []) as any[]) {
      productIdByShopifyId.set(row.shopify_product_id, row.id);
    }

    const mediaRows: any[] = [];
    const variantRows: any[] = [];
    const joinRows: any[] = [];

    for (const product of products) {
      const productId = productIdByShopifyId.get(product.id);
      if (!productId) continue;

      (product.media?.nodes ?? []).forEach((node, index) => {
        const image = node.preview?.image;
        if (!image?.url) return;
        mediaRows.push({
          product_id: productId,
          shopify_media_id: node.id,
          position: index,
          media_type: node.mediaContentType,
          url: image.url,
          alt_text: node.alt,
          width: image.width ?? null,
          height: image.height ?? null,
        });
      });

      (product.variants?.nodes ?? []).forEach((variant, index) => {
        variantRows.push({
          product_id: productId,
          shopify_variant_id: variant.id,
          title: variant.title,
          position: index,
          price: toNumber(variant.price),
          compare_at_price: toNumber(variant.compareAtPrice),
          currency: product.priceRangeV2?.minVariantPrice?.currencyCode ?? null,
          sku: variant.sku,
          image_url: variant.image?.url ?? null,
          selected_options: variant.selectedOptions ?? [],
          available_for_sale: variant.availableForSale,
          inventory_quantity: variant.inventoryQuantity ?? null,
          shopify_updated_at: variant.updatedAt,
          last_synced_at: syncedAt,
        });
      });

      for (const node of product.collections?.nodes ?? []) {
        const collectionId = collectionIdByShopifyId.get(node.id);
        if (collectionId) joinRows.push({ product_id: productId, collection_id: collectionId });
      }
    }

    if (mediaRows.length > 0) {
      const { error: mediaError } = await supabase
        .from("shopify_product_media")
        .upsert(mediaRows, { onConflict: "product_id,shopify_media_id" });
      if (mediaError) throw new Error(mediaError.message);
      mediaCount = mediaRows.length;
    }
    if (variantRows.length > 0) {
      const { error: variantError } = await supabase
        .from("shopify_product_variants")
        .upsert(variantRows, { onConflict: "shopify_variant_id" });
      if (variantError) throw new Error(variantError.message);
      variantCount = variantRows.length;
    }
    if (joinRows.length > 0) {
      await supabase
        .from("shopify_product_collections")
        .upsert(joinRows, { onConflict: "product_id,collection_id" });
    }
  }

  return {
    products: products.length,
    collections: collections.length,
    variants: variantCount,
    media: mediaCount,
    syncedAt,
  };
}

export async function recordSyncEvent(
  _supabase: SupabaseClient<any, "public", any>,
  input: {
    status: "success" | "failed";
    message: string;
    payload?: Record<string, unknown>;
    eventType?: string;
  },
): Promise<void> {
  // Event writes use the privileged client: the browser role has read only
  // access to the audit trail by design.
  const supabase = await adminClient();
  const id = await integrationId(supabase);

  await supabase.from("integration_events").insert({
    integration_id: id,
    event_type: input.eventType ?? "catalogue_sync",
    status: input.status,
    message: input.message,
    payload: input.payload ?? {},
  });
}

