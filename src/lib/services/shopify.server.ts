/**
 * Store connection service.
 *
 * Pairing uses the current Shopify client credentials grant. The admin panel
 * stores the shop domain, client ID and API version as ordinary settings and
 * keeps the client secret in the encrypted vault. A short lived Admin API
 * access token is acquired server side on demand and cached in memory only.
 * No secret is ever returned to the browser or written to an event payload.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ShopifyCredentialStatus {
  configured: boolean;
  shopDomain: string | null;
  apiVersion: string;
  clientId: string | null;
  missing: string[];
  source: "database" | "environment" | "none";
  hasStoredSecret: boolean;
  /** Legacy field name kept so existing admin views do not break. */
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
  clientId: "SHOPIFY_CLIENT_ID",
  clientSecret: "SHOPIFY_CLIENT_SECRET",
} as const;

/** Vault secret name for the legacy Admin API access token. */
export const SHOPIFY_VAULT_SECRET = "shopify_admin_api_token";
/** Vault secret name for the app client secret. */
export const SHOPIFY_CLIENT_SECRET_VAULT = "shopify_client_secret";

export const DEFAULT_API_VERSION = "2026-07";

const SETTING_KEYS = {
  shopDomain: "shop_domain",
  apiVersion: "api_version",
  adminToken: "admin_api_token",
  clientId: "client_id",
  clientSecret: "client_secret",
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

/** Environment read. Kept as a backwards compatible fallback. */
export function readShopifyCredentials(): {
  shopDomain: string | null;
  adminToken: string | null;
  clientId: string | null;
  clientSecret: string | null;
  apiVersion: string;
  missing: string[];
} {
  const shopDomain = process.env[SHOPIFY_SECRET_NAMES.shopDomain]?.trim() || null;
  const adminToken = process.env[SHOPIFY_SECRET_NAMES.adminToken]?.trim() || null;
  const clientId = process.env[SHOPIFY_SECRET_NAMES.clientId]?.trim() || null;
  const clientSecret = process.env[SHOPIFY_SECRET_NAMES.clientSecret]?.trim() || null;
  const apiVersion = process.env[SHOPIFY_SECRET_NAMES.apiVersion]?.trim() || DEFAULT_API_VERSION;

  const missing: string[] = [];
  if (!shopDomain) missing.push(SHOPIFY_SECRET_NAMES.shopDomain);
  if (!adminToken && !(clientId && clientSecret)) missing.push(SHOPIFY_SECRET_NAMES.clientId);

  return { shopDomain, adminToken, clientId, clientSecret, apiVersion, missing };
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
  apiVersion: string;
  clientId: string | null;
  clientSecret: string | null;
  /** Legacy access token, environment or vault, used only when no client pair exists. */
  adminToken: string | null;
  missing: string[];
  source: "database" | "environment" | "none";
  hasStoredSecret: boolean;
  hasStoredToken: boolean;
}

/** Database configured credentials win over environment values. */
export async function resolveShopifyCredentials(): Promise<ResolvedCredentials> {
  const env = readShopifyCredentials();
  let dbDomain: string | null = null;
  let dbVersion: string | null = null;
  let dbClientId: string | null = null;
  let dbClientSecret: string | null = null;
  let dbToken: string | null = null;

  try {
    const supabase = await adminClient();
    const settings = await readSettings(supabase);
    dbDomain = settings.get(SETTING_KEYS.shopDomain) ?? null;
    dbVersion = settings.get(SETTING_KEYS.apiVersion) ?? null;
    dbClientId = settings.get(SETTING_KEYS.clientId) ?? null;
    const secret = await supabase.rpc("get_integration_secret", {
      _name: SHOPIFY_CLIENT_SECRET_VAULT,
    });
    dbClientSecret =
      typeof secret.data === "string" && secret.data.trim() ? secret.data.trim() : null;
    const legacy = await supabase.rpc("get_integration_secret", {
      _name: SHOPIFY_VAULT_SECRET,
    });
    dbToken = typeof legacy.data === "string" && legacy.data.trim() ? legacy.data.trim() : null;
  } catch {
    // Vault or settings unavailable. Environment fallback still applies.
  }

  const shopDomain = dbDomain || env.shopDomain;
  const clientId = dbClientId || env.clientId;
  const clientSecret = dbClientSecret || env.clientSecret;
  const adminToken = dbToken || env.adminToken;
  const apiVersion = dbVersion || env.apiVersion || DEFAULT_API_VERSION;

  const hasClientPair = Boolean(clientId && clientSecret);

  const missing: string[] = [];
  if (!shopDomain) missing.push("Store domain");
  if (!hasClientPair && !adminToken) {
    if (!clientId) missing.push("Client ID");
    if (!clientSecret) missing.push("Client secret");
  }

  const source: ResolvedCredentials["source"] =
    dbDomain && (dbClientSecret || dbToken)
      ? "database"
      : shopDomain && (hasClientPair || adminToken)
        ? "environment"
        : "none";

  return {
    shopDomain,
    apiVersion,
    clientId,
    clientSecret,
    adminToken,
    missing,
    source,
    hasStoredSecret: Boolean(dbClientSecret),
    hasStoredToken: Boolean(dbToken),
  };
}

/* ----------------------- access token acquisition ----------------------- */

interface CachedToken {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

/**
 * Exchanges the client ID and client secret for a short lived Admin API access
 * token using the Shopify client credentials grant. Tokens are cached in memory
 * until shortly before expiry so the owner never has to intervene.
 */
export async function acquireAccessToken(input: {
  shopDomain: string;
  clientId: string;
  clientSecret: string;
  force?: boolean;
}): Promise<string> {
  const key = `${input.shopDomain}:${input.clientId}`;
  const cached = tokenCache.get(key);
  if (!input.force && cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  let response: Response;
  try {
    response = await fetch(`https://${input.shopDomain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        client_id: input.clientId,
        client_secret: input.clientSecret,
        grant_type: "client_credentials",
      }),
    });
  } catch {
    throw new Error(
      `The store at ${input.shopDomain} could not be reached. Check the .myshopify.com domain.`,
    );
  }

  if (response.status === 404) {
    throw new Error(
      `No Shopify store was found at ${input.shopDomain}. Use the exact .myshopify.com domain.`,
    );
  }
  if (response.status === 400 || response.status === 401) {
    throw new Error(
      `Shopify rejected the client credentials for ${input.shopDomain}. Confirm the Client ID and Client secret are from the app built for this organisation, that the app has a released version, and that it is installed on this store.`,
    );
  }
  if (!response.ok) {
    throw new Error(`Shopify returned ${response.status} while issuing an access token.`);
  }

  const payload = (await response.json().catch(() => null)) as
    | { access_token?: string; expires_in?: number; error?: string }
    | null;
  if (!payload?.access_token) {
    throw new Error(
      payload?.error
        ? `Shopify declined the token request: ${payload.error}`
        : "Shopify did not return an access token for these client credentials.",
    );
  }

  const ttl = typeof payload.expires_in === "number" ? payload.expires_in : 86_400;
  tokenCache.set(key, { token: payload.access_token, expiresAt: Date.now() + ttl * 1000 });
  return payload.access_token;
}

/** Returns a usable Admin API token, acquiring a fresh one when needed. */
export async function getAdminAccessToken(
  resolved: ResolvedCredentials,
  force = false,
): Promise<string> {
  if (!resolved.shopDomain) throw new Error("A store domain is required");
  if (resolved.clientId && resolved.clientSecret) {
    return acquireAccessToken({
      shopDomain: resolved.shopDomain,
      clientId: resolved.clientId,
      clientSecret: resolved.clientSecret,
      force,
    });
  }
  if (resolved.adminToken) return resolved.adminToken;
  throw new Error("Store credentials are not configured");
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
    clientId: resolved.clientId,
    missing: resolved.missing,
    source: resolved.source,
    hasStoredSecret: resolved.hasStoredSecret,
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

/**
 * Checkout host used for basket links. The owner sets this when the store's own
 * primary domain is serving something else, otherwise the paired store host is
 * used and the store handles the redirect.
 */
export async function getCheckoutDomainSetting(): Promise<{
  checkoutDomain: string | null;
  shopDomain: string | null;
}> {
  const settings = await readSettings(await adminClient());
  const resolved = await resolveShopifyCredentials();
  return {
    checkoutDomain: settings.get("checkout_domain") ?? null,
    shopDomain: resolved.shopDomain,
  };
}

export async function setCheckoutDomainSetting(value: string | null): Promise<void> {
  const supabase = await adminClient();
  await writeSetting(
    supabase,
    "checkout_domain",
    "Checkout domain",
    value ? normaliseShopDomain(value) : null,
    {
      helpText:
        "Host that serves the basket and payment pages. Leave empty to use the paired store domain.",
    },
  );
}


/* ---------------------------- GraphQL client ---------------------------- */

const SCOPE_ADVICE =
  "Confirm the app version includes read_products, read_inventory, read_legal_policies, read_content and read_online_store_pages, release the version, then reinstall it on this store.";

export async function shopifyGraphql<T>(
  credentials: { shopDomain: string; adminToken: string; apiVersion: string },
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
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
      `The store at ${credentials.shopDomain} rejected the access token (401). The app may no longer be installed on this store, or the client credentials belong to a different store.`,
    );
  }
  if (response.status === 403) {
    throw new Error(`The access token is missing Admin API scopes (403). ${SCOPE_ADVICE}`);
  }
  if (response.status === 404) {
    throw new Error(
      `No Admin API was found at ${credentials.shopDomain} for version ${credentials.apiVersion}. Check the .myshopify.com domain and the API version.`,
    );
  }
  if (response.status === 402) {
    throw new Error("The store is frozen or unavailable for API access (402). Check the store status in Shopify.");
  }
  if (response.status === 423) {
    throw new Error("The store is locked (423) and cannot serve Admin API requests.");
  }
  if (!response.ok) {
    throw new Error(`The store responded with ${response.status}`);
  }

  const payload = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (payload.errors?.length) {
    const message = payload.errors.map((e) => e.message).join("; ");
    if (/access denied|not approved|scope/i.test(message)) {
      throw new Error(`The app is missing an Admin API scope. Shopify said: ${message}. ${SCOPE_ADVICE}`);
    }
    if (/unsupported.*version|version.*not.*supported|invalid api version/i.test(message)) {
      throw new Error(
        `Shopify does not support Admin API version ${credentials.apiVersion}. Use a supported stable version such as ${DEFAULT_API_VERSION}.`,
      );
    }
    throw new Error(message);
  }
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

/**
 * Acquires an access token from the client credentials when they are supplied,
 * then runs a minimal shop query. Only safe store metadata is returned.
 */
export async function testShopifyConnection(input: {
  shopDomain: string;
  apiVersion: string;
  clientId?: string | null;
  clientSecret?: string | null;
  adminToken?: string | null;
}): Promise<ConnectionTestResult> {
  const adminToken =
    input.clientId && input.clientSecret
      ? await acquireAccessToken({
          shopDomain: input.shopDomain,
          clientId: input.clientId,
          clientSecret: input.clientSecret,
          force: true,
        })
      : input.adminToken;
  if (!adminToken) throw new Error("A Client ID and Client secret are required");

  const data = await shopifyGraphql<{
    shop: {
      name: string;
      myshopifyDomain: string;
      primaryDomain: { host: string } | null;
      currencyCode: string | null;
    };
  }>({ shopDomain: input.shopDomain, apiVersion: input.apiVersion, adminToken }, SHOP_QUERY);

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
  clientId?: string | null;
  clientSecret?: string | null;
  shopName?: string | null;
}): Promise<void> {
  const supabase = await adminClient();
  if (input.clientSecret) {
    const { error } = await supabase.rpc("set_integration_secret", {
      _name: SHOPIFY_CLIENT_SECRET_VAULT,
      _secret: input.clientSecret,
    });
    if (error) throw new Error("The client secret could not be stored securely");
  }
  await writeSetting(supabase, SETTING_KEYS.shopDomain, "Store domain", input.shopDomain);
  await writeSetting(supabase, SETTING_KEYS.apiVersion, "Admin API version", input.apiVersion);
  if (input.clientId) {
    await writeSetting(supabase, SETTING_KEYS.clientId, "Client ID", input.clientId);
  }
  await writeSetting(supabase, SETTING_KEYS.clientSecret, "Client secret", null, {
    isSecretReference: true,
    secretName: SHOPIFY_CLIENT_SECRET_VAULT,
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
  await supabase.rpc("delete_integration_secret", { _name: SHOPIFY_CLIENT_SECRET_VAULT });
  tokenCache.clear();
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
        SETTING_KEYS.clientId,
        SETTING_KEYS.clientSecret,
        SETTING_KEYS.shopName,
        SETTING_KEYS.lastTestedAt,
        SETTING_KEYS.lastSyncedAt,
        SETTING_KEYS.lastError,
      ]);
  }
  await markConnectionState({ state: "not_connected", error: null });
}


/* ------------------------------ catalogue ------------------------------ */

const PRODUCT_FIELDS = /* GraphQL */ `
  fragment NurGoodsProductFields on Product {
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
    createdAt
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
    variants(first: 100) {
      nodes {
        id
        title
        sku
        barcode
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
`;

const CATALOGUE_QUERY = /* GraphQL */ `
  ${PRODUCT_FIELDS}
  query NurGoodsCatalogue($productCursor: String) {
    products(first: 10, after: $productCursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        ...NurGoodsProductFields
      }
    }
  }
`;

/** A single product, used by the intake webhook. */
const PRODUCT_BY_ID_QUERY = /* GraphQL */ `
  ${PRODUCT_FIELDS}
  query NurGoodsProduct($id: ID!) {
    product(id: $id) {
      ...NurGoodsProductFields
    }
  }
`;

/** Recently changed products, used by the intake delta sync. */
const PRODUCTS_CHANGED_QUERY = /* GraphQL */ `
  ${PRODUCT_FIELDS}
  query NurGoodsChangedProducts($search: String!, $cursor: String) {
    products(first: 25, after: $cursor, query: $search, sortKey: UPDATED_AT, reverse: true) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        ...NurGoodsProductFields
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
  createdAt?: string | null;
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
      barcode: string | null;
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
  if (!resolved.shopDomain || resolved.missing.length > 0) {
    throw new Error(`Store credentials missing: ${resolved.missing.join(", ")}`);
  }
  const adminToken = await getAdminAccessToken(resolved);
  const credentials = {
    shopDomain: resolved.shopDomain,
    adminToken,
    apiVersion: resolved.apiVersion,
  };


  const syncedAt = new Date().toISOString();

  const products: GraphQlProduct[] = [];
  let cursor: string | null = null;
  // Smaller product pages keep the variant connection deep enough to mirror
  // every option of a wide product, so the page budget is raised to match.
  for (let page = 0; page < 200; page += 1) {

    const data: any = await shopifyGraphql(credentials, CATALOGUE_QUERY, { productCursor: cursor });
    products.push(...(data.products.nodes as GraphQlProduct[]));
    if (!data.products.pageInfo.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
  }

  const collections: GraphQlCollection[] = [];
  cursor = null;
  for (let page = 0; page < 20; page += 1) {
    const data: any = await shopifyGraphql(credentials, COLLECTIONS_QUERY, { cursor });
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

  const upserted = await upsertShopifyProducts(
    supabase,
    products,
    syncedAt,
    collectionIdByShopifyId,
  );
  const variantCount = upserted.variants;
  const mediaCount = upserted.media;

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


/**
 * Mirrors a set of Shopify products into the read only catalogue tables. The
 * supplier record itself is never written back: this only refreshes the NUR
 * GOODS mirror and queues intelligence work.
 */
export async function upsertShopifyProducts(
  supabase: SupabaseClient<any, "public", any>,
  products: GraphQlProduct[],
  syncedAt: string,
  collectionIdByShopifyId: Map<string, string>,
  planReason = "Catalogue sync",
): Promise<{ variants: number; media: number; productIdByShopifyId: Map<string, string> }> {
  let variantCount = 0;
  let mediaCount = 0;
  const productIdByShopifyId = new Map<string, string>();
  if (products.length === 0) return { variants: 0, media: 0, productIdByShopifyId };

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
        barcode: variant.barcode ?? null,
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

  // The store stays authoritative for the record itself. The canonical
  // category and search intelligence are worked out here, so every mirrored
  // product is checked for a material change and queued when one is found.
  // Price and stock only changes are filtered out inside planWork.
  try {
    const { planWork } = await import("@/lib/intelligence/queue.server");
    await planWork(supabase as never, [...productIdByShopifyId.values()], planReason);
  } catch {
    // Intelligence planning must never fail a catalogue sync. The daily
    // maintenance job picks up anything missed here.
  }

  return { variants: variantCount, media: mediaCount, productIdByShopifyId };
}


/* --------------------------- intake fetchers --------------------------- */

export async function intakeCredentials(): Promise<{
  shopDomain: string;
  adminToken: string;
  apiVersion: string;
}> {
  const resolved = await resolveShopifyCredentials();
  if (!resolved.shopDomain || resolved.missing.length > 0) {
    throw new Error(`Store credentials missing: ${resolved.missing.join(", ")}`);
  }
  return {
    shopDomain: resolved.shopDomain,
    adminToken: await getAdminAccessToken(resolved),
    apiVersion: resolved.apiVersion,
  };
}

/** Reads one product straight from the store. Nothing is written back. */
export async function fetchShopifyProductById(
  shopifyProductId: string,
): Promise<GraphQlProduct | null> {
  const credentials = await intakeCredentials();
  const data: any = await shopifyGraphql(credentials, PRODUCT_BY_ID_QUERY, {
    id: shopifyProductId,
  });
  return (data?.product as GraphQlProduct | null) ?? null;
}

/** Products changed since a timestamp, newest first. Used by the delta sync. */
export async function fetchShopifyProductsUpdatedSince(
  since: string,
  maxPages = 4,
): Promise<GraphQlProduct[]> {
  const credentials = await intakeCredentials();
  const search = `updated_at:>'${since.replace(/'/g, "")}'`;
  const out: GraphQlProduct[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const data: any = await shopifyGraphql(credentials, PRODUCTS_CHANGED_QUERY, {
      search,
      cursor,
    });
    out.push(...((data?.products?.nodes ?? []) as GraphQlProduct[]));
    if (!data?.products?.pageInfo?.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
  }
  return out;
}

/**
 * Mirrors a small set of products without touching the rest of the catalogue.
 * Collection links are resolved against collections already mirrored here.
 */
export async function mirrorShopifyProducts(
  supabase: SupabaseClient<any, "public", any>,
  products: GraphQlProduct[],
  reason: string,
): Promise<Map<string, string>> {
  if (products.length === 0) return new Map();
  const { data: collections } = await supabase
    .from("shopify_collections")
    .select("id, shopify_collection_id")
    .limit(1000);
  const map = new Map<string, string>(
    ((collections ?? []) as any[]).map((row) => [row.shopify_collection_id as string, row.id as string]),
  );
  const result = await upsertShopifyProducts(
    supabase,
    products,
    new Date().toISOString(),
    map,
    reason,
  );
  return result.productIdByShopifyId;
}

/** The signing secret Shopify uses for webhook payloads. */
export async function getWebhookSigningSecret(): Promise<string | null> {
  const explicit = process.env["SHOPIFY_WEBHOOK_SECRET"]?.trim();
  if (explicit) return explicit;
  const resolved = await resolveShopifyCredentials();
  return resolved.clientSecret ?? null;
}

export const INTAKE_WEBHOOK_TOPICS = ["PRODUCTS_CREATE", "PRODUCTS_UPDATE"] as const;

export interface WebhookSubscriptionState {
  supported: boolean;
  registered: string[];
  missing: string[];
  callbackUrl: string;
  error: string | null;
}

const WEBHOOK_LIST_QUERY = /* GraphQL */ `
  query NurGoodsWebhooks {
    webhookSubscriptions(first: 50) {
      nodes {
        id
        topic
        endpoint {
          __typename
          ... on WebhookHttpEndpoint {
            callbackUrl
          }
        }
      }
    }
  }
`;

const WEBHOOK_CREATE_MUTATION = /* GraphQL */ `
  mutation NurGoodsWebhookCreate($topic: WebhookSubscriptionTopic!, $callbackUrl: URL!) {
    webhookSubscriptionCreate(
      topic: $topic
      webhookSubscription: { callbackUrl: $callbackUrl, format: JSON }
    ) {
      webhookSubscription {
        id
        topic
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/** Reports which product intake webhooks the store already sends here. */
export async function getWebhookSubscriptionState(
  callbackUrl: string,
): Promise<WebhookSubscriptionState> {
  try {
    const credentials = await intakeCredentials();
    const data: any = await shopifyGraphql(credentials, WEBHOOK_LIST_QUERY, {});
    const nodes = (data?.webhookSubscriptions?.nodes ?? []) as any[];
    const registered = nodes
      .filter((node) => node?.endpoint?.callbackUrl === callbackUrl)
      .map((node) => String(node.topic));
    return {
      supported: true,
      registered,
      missing: INTAKE_WEBHOOK_TOPICS.filter((topic) => !registered.includes(topic)),
      callbackUrl,
      error: null,
    };
  } catch (cause) {
    return {
      supported: false,
      registered: [],
      missing: [...INTAKE_WEBHOOK_TOPICS],
      callbackUrl,
      error: cause instanceof Error ? cause.message : "The store could not be reached",
    };
  }
}

/** Registers the product create and update webhooks when scopes allow it. */
export async function registerIntakeWebhooks(
  callbackUrl: string,
): Promise<WebhookSubscriptionState> {
  const before = await getWebhookSubscriptionState(callbackUrl);
  if (!before.supported) return before;
  const credentials = await intakeCredentials();
  for (const topic of before.missing) {
    const data: any = await shopifyGraphql(credentials, WEBHOOK_CREATE_MUTATION, {
      topic,
      callbackUrl,
    });
    const errors = data?.webhookSubscriptionCreate?.userErrors ?? [];
    if (errors.length > 0) {
      return {
        ...before,
        error: errors.map((item: any) => item.message).join(", "),
      };
    }
  }
  return getWebhookSubscriptionState(callbackUrl);
}

/**
 * Canonical public callback for paid store orders.
 *
 * The store refuses to register a webhook against any hostname already
 * attached to the store itself, which includes nurgoods.com. When the order
 * callback has to answer on a separate hostname, set ORDER_WEBHOOK_URL to that
 * full https URL and registration will use it.
 */
export const ORDER_WEBHOOK_CALLBACK_URL =
  process.env["ORDER_WEBHOOK_URL"]?.trim() || "https://nurgoods.com/api/public/hooks/shopify-orders";

/**
 * Order topics NUR GOODS needs. ORDERS_PAID starts the ledger, and the
 * cancellation and update topics keep the recorded state accurate when an
 * order changes after payment.
 */
export const ORDER_WEBHOOK_TOPICS = ["ORDERS_PAID", "ORDERS_CANCELLED", "ORDERS_UPDATED"];

/**
 * Reports which order webhooks the store already sends to the given callback.
 * Read only, so it is safe to call before the route is deployed.
 */
export async function getOrderWebhookState(
  callbackUrl: string = ORDER_WEBHOOK_CALLBACK_URL,
): Promise<WebhookSubscriptionState> {
  try {
    const credentials = await intakeCredentials();
    const data: any = await shopifyGraphql(credentials, WEBHOOK_LIST_QUERY, {});
    const nodes = (data?.webhookSubscriptions?.nodes ?? []) as any[];
    const registered = nodes
      .filter((node) => node?.endpoint?.callbackUrl === callbackUrl)
      .map((node) => String(node.topic));
    return {
      supported: true,
      registered,
      missing: ORDER_WEBHOOK_TOPICS.filter((topic) => !registered.includes(topic)),
      callbackUrl,
      error: null,
    };
  } catch (cause) {
    return {
      supported: false,
      registered: [],
      missing: [...ORDER_WEBHOOK_TOPICS],
      callbackUrl,
      error: cause instanceof Error ? cause.message : "The store could not be reached",
    };
  }
}

/**
 * Registers the order webhooks. This refuses to run until the callback answers,
 * so a subscription is never pointed at a route that is not live yet. Invoke it
 * after deployment.
 */
export async function registerOrderWebhooks(
  callbackUrl: string = ORDER_WEBHOOK_CALLBACK_URL,
): Promise<WebhookSubscriptionState> {
  let reachable = false;
  try {
    // An unsigned probe. The live route answers 401, which proves it exists.
    const probe = await fetch(callbackUrl, { method: "POST", body: "{}" });
    reachable = probe.status !== 404 && probe.status < 500;
  } catch {
    reachable = false;
  }
  if (!reachable) {
    return {
      supported: false,
      registered: [],
      missing: [...ORDER_WEBHOOK_TOPICS],
      callbackUrl,
      error: "The order callback is not answering yet, so nothing was registered",
    };
  }

  const before = await getOrderWebhookState(callbackUrl);
  if (!before.supported) return before;
  const credentials = await intakeCredentials();
  for (const topic of before.missing) {
    const data: any = await shopifyGraphql(credentials, WEBHOOK_CREATE_MUTATION, { topic, callbackUrl });
    const errors = data?.webhookSubscriptionCreate?.userErrors ?? [];
    if (errors.length > 0) {
      return { ...before, error: errors.map((item: any) => item.message).join(", ") };
    }
  }
  return getOrderWebhookState(callbackUrl);
}
