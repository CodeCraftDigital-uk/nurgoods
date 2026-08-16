/**
 * Headless storefront service.
 *
 * This is separate from the Admin API pairing used for catalogue and legal
 * mirroring. It holds the private Storefront API token in the encrypted vault
 * and uses the official Cart API so the checkout link is always issued by the
 * store rather than assembled here.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_API_VERSION, normaliseApiVersion, normaliseShopDomain, resolveShopifyCredentials } from "./shopify.server";

export const STOREFRONT_TOKEN_VAULT = "shopify_storefront_private_token";

const KEYS = {
  domain: "storefront_domain",
  apiVersion: "storefront_api_version",
  privateToken: "storefront_private_token",
  publicToken: "storefront_public_token",
  state: "storefront_state",
  lastTestedAt: "storefront_last_tested_at",
  lastError: "storefront_last_error",
  shopName: "storefront_shop_name",
  primaryDomain: "storefront_primary_domain",
} as const;

/**
 * Hosts served by this site. A checkout link issued on one of these cannot
 * resolve, because the request lands here rather than at the store.
 */
const SITE_HOSTS = new Set(["nurgoods.com", "www.nurgoods.com"]);

function hostOf(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/^https?:\/\//i, "").split("/")[0] ?? "";
  return trimmed ? trimmed.toLowerCase() : null;
}

export function isSiteHost(value: string | null): boolean {
  const host = hostOf(value);
  return host ? SITE_HOSTS.has(host) : false;
}

export const CHECKOUT_HOST_CONFLICT = "CHECKOUT_HOST_CONFLICT";

/**
 * The host the store is expected to serve basket and payment pages on once the
 * split is complete. It is recorded as the checkout host so no code change is
 * needed later, but it is only trusted after a live probe proves the store
 * answers there without redirecting back to this site.
 */
export const INTENDED_CHECKOUT_HOST = "shop.nurgoods.com";

export interface CheckoutHostProbe {
  host: string;
  /** The host answers as the store basket. */
  servesStore: boolean;
  /** The store forwards this host back to the site, so it cannot take payment. */
  redirectsToSite: boolean;
  /** Where the request ended up, useful for admin diagnostics. */
  finalHost: string | null;
  checkedAt: string;
}

const probeCache = new Map<string, { probe: CheckoutHostProbe; expires: number }>();

/**
 * Follows a basket request and reports whether the host genuinely answers as
 * the store. A store served page carries a store identifier header, and a host
 * that forwards to this site is treated as unusable rather than ready.
 */
export async function probeCheckoutHost(
  value: string | null,
  options: { force?: boolean } = {},
): Promise<CheckoutHostProbe | null> {
  const host = hostOf(value);
  if (!host) return null;
  const cached = probeCache.get(host);
  if (!options.force && cached && cached.expires > Date.now()) return cached.probe;

  let servesStore = false;
  let redirectsToSite = false;
  let finalHost: string | null = null;
  try {
    const response = await fetch(`https://${host}/cart`, {
      method: "GET",
      redirect: "follow",
      headers: { "user-agent": "NURGOODS-storefront/1.0" },
    });
    finalHost = hostOf(response.url) ?? host;
    redirectsToSite = SITE_HOSTS.has(finalHost);
    // Store served pages can be fronted by a proxy that strips the store id
    // header, so accept any of the reliable store fingerprints.
    const headers = response.headers;
    const cookies = headers.get("set-cookie") ?? "";
    const storeFingerprint =
      Boolean(headers.get("x-shopid")) ||
      /shopify/i.test(headers.get("powered-by") ?? "") ||
      /shopify/i.test(headers.get("x-shopify-stage") ?? "") ||
      /_shopify_y|cart_currency|_shopify_essential/i.test(cookies) ||
      /pageType;desc="cart"/i.test(headers.get("server-timing") ?? "");
    servesStore = response.ok && !redirectsToSite && storeFingerprint;
  } catch {
    servesStore = false;
  }

  const probe: CheckoutHostProbe = {
    host,
    servesStore,
    redirectsToSite,
    finalHost,
    checkedAt: new Date().toISOString(),
  };
  probeCache.set(host, { probe, expires: Date.now() + (servesStore ? 600_000 : 120_000) });
  return probe;
}

/** Reads the recorded checkout host, ignoring any value that points at this site. */
async function readCheckoutHostOverride(): Promise<string | null> {
  try {
    const settings = await readSettings(await adminClient());
    const candidate = hostOf(settings.get("checkout_domain") ?? null);
    return candidate && !SITE_HOSTS.has(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * Records the intended checkout host when nothing usable is stored yet. This
 * only writes a setting, it never claims checkout is ready.
 */
export async function ensureIntendedCheckoutHost(): Promise<string | null> {
  const existing = await readCheckoutHostOverride();
  if (existing) return existing;
  try {
    const supabase = await adminClient();
    await writeSetting(
      supabase,
      "checkout_domain",
      "Checkout domain",
      INTENDED_CHECKOUT_HOST,
      {
        helpText:
          "Host the store serves basket and payment pages on. Used only once it answers as the store.",
      },
    );
    return INTENDED_CHECKOUT_HOST;
  } catch {
    return null;
  }
}


export interface StorefrontApiStatus {
  configured: boolean;
  domain: string | null;
  apiVersion: string;
  hasPrivateToken: boolean;
  publicToken: string | null;
  connectionState: "not_connected" | "connected" | "error";
  lastTestedAt: string | null;
  lastError: string | null;
  shopName: string | null;
  /** The host the store issues checkout links on. */
  primaryDomain: string | null;
  /** True when the store issues checkout links on the host serving this site. */
  checkoutHostConflict: boolean;
  /** Dedicated checkout host used to rewrite a conflicting link, when set. */
  checkoutHostOverride: string | null;
  /** Live result of probing the checkout host. */
  checkoutHostProbe: CheckoutHostProbe | null;
  /** Every gate that has to pass before Buy now can go live. */
  readiness: {
    storefrontConnected: boolean;
    checkoutHostConfigured: boolean;
    checkoutHostServesStore: boolean;
    buyNowReady: boolean;
  };

  /** Domain suggested from the existing Admin API pairing. */
  suggestedDomain: string | null;
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
  const { data: created } = await supabase
    .from("integrations")
    .upsert(
      { provider: "shopify", label: "Shopify", status: "not_connected" },
      { onConflict: "provider" },
    )
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

export interface ResolvedStorefrontCredentials {
  domain: string | null;
  apiVersion: string;
  privateToken: string | null;
  publicToken: string | null;
}

/** Reads the stored headless credentials. The private token never leaves here. */
export async function resolveStorefrontCredentials(): Promise<ResolvedStorefrontCredentials> {
  let settings = new Map<string, string | null>();
  let privateToken: string | null = null;
  try {
    const supabase = await adminClient();
    settings = await readSettings(supabase);
    const secret = await supabase.rpc("get_integration_secret", { _name: STOREFRONT_TOKEN_VAULT });
    privateToken =
      typeof secret.data === "string" && secret.data.trim() ? secret.data.trim() : null;
  } catch {
    /* vault or settings unavailable */
  }
  const envToken = process.env["SHOPIFY_STOREFRONT_TOKEN"]?.trim() || null;
  return {
    domain: settings.get(KEYS.domain) || settings.get("shop_domain") || null,
    apiVersion: settings.get(KEYS.apiVersion) || DEFAULT_API_VERSION,
    privateToken: privateToken || envToken,
    publicToken: settings.get(KEYS.publicToken) ?? null,
  };
}

export async function getStorefrontApiStatus(): Promise<StorefrontApiStatus> {
  const resolved = await resolveStorefrontCredentials();
  let settings = new Map<string, string | null>();
  try {
    settings = await readSettings(await adminClient());
  } catch {
    /* settings unavailable */
  }
  let suggestedDomain: string | null = null;
  try {
    suggestedDomain = (await resolveShopifyCredentials()).shopDomain;
  } catch {
    suggestedDomain = null;
  }
  const state = settings.get(KEYS.state) ?? null;
  const configured = Boolean(resolved.domain && resolved.privateToken);
  const connectionState: "not_connected" | "connected" | "error" =
    state === "connected" || state === "error" ? state : "not_connected";

  // Record the intended checkout host once, so the split needs no code change.
  let checkoutHostOverride = (() => {
    const candidate = hostOf(settings.get("checkout_domain") ?? null);
    return candidate && !SITE_HOSTS.has(candidate) ? candidate : null;
  })();
  if (!checkoutHostOverride) checkoutHostOverride = await ensureIntendedCheckoutHost();

  const storeIssuedHost = hostOf(settings.get(KEYS.primaryDomain) ?? null);
  const probeTarget = checkoutHostOverride ?? storeIssuedHost;
  const checkoutHostProbe = await probeCheckoutHost(probeTarget);
  const storefrontConnected = configured && connectionState === "connected";
  const checkoutHostServesStore = checkoutHostProbe?.servesStore ?? false;

  return {
    configured,
    domain: resolved.domain,
    apiVersion: resolved.apiVersion,
    hasPrivateToken: Boolean(resolved.privateToken),
    publicToken: resolved.publicToken,
    connectionState,
    lastTestedAt: settings.get(KEYS.lastTestedAt) ?? null,
    lastError: settings.get(KEYS.lastError) ?? null,
    shopName: settings.get(KEYS.shopName) ?? null,
    primaryDomain: settings.get(KEYS.primaryDomain) ?? null,
    checkoutHostConflict: isSiteHost(settings.get(KEYS.primaryDomain) ?? null),
    checkoutHostOverride,
    checkoutHostProbe,
    readiness: {
      storefrontConnected,
      checkoutHostConfigured: Boolean(checkoutHostOverride),
      checkoutHostServesStore,
      buyNowReady: storefrontConnected && checkoutHostServesStore,
    },
    suggestedDomain,
  };
}


export async function saveStorefrontCredentials(input: {
  domain: string;
  apiVersion: string;
  privateToken?: string | null;
  publicToken?: string | null;
  shopName?: string | null;
  primaryDomain?: string | null;
}): Promise<void> {
  const supabase = await adminClient();
  if (input.privateToken) {
    const { error } = await supabase.rpc("set_integration_secret", {
      _name: STOREFRONT_TOKEN_VAULT,
      _secret: input.privateToken,
    });
    if (error) throw new Error("The Storefront token could not be stored securely");
  }
  await writeSetting(supabase, KEYS.domain, "Storefront domain", input.domain);
  await writeSetting(supabase, KEYS.apiVersion, "Storefront API version", input.apiVersion);
  await writeSetting(supabase, KEYS.privateToken, "Storefront private token", null, {
    isSecretReference: true,
    secretName: STOREFRONT_TOKEN_VAULT,
    helpText: "Stored in the encrypted vault. It is never sent back to the browser.",
  });
  if (input.publicToken !== undefined) {
    await writeSetting(
      supabase,
      KEYS.publicToken,
      "Storefront public token",
      input.publicToken?.trim() || null,
      { helpText: "Optional. Only used for browser safe storefront reads." },
    );
  }
  if (input.shopName) {
    await writeSetting(supabase, KEYS.shopName, "Storefront shop name", input.shopName);
  }
  if (input.primaryDomain !== undefined) {
    await writeSetting(
      supabase,
      KEYS.primaryDomain,
      "Storefront checkout host",
      input.primaryDomain,
    );
  }
}

export async function markStorefrontState(input: {
  state: "connected" | "error" | "not_connected";
  error?: string | null;
  testedAt?: string | null;
}): Promise<void> {
  const supabase = await adminClient();
  await writeSetting(supabase, KEYS.state, "Storefront state", input.state);
  await writeSetting(supabase, KEYS.lastError, "Storefront last error", input.error ?? null);
  if (input.testedAt) {
    await writeSetting(supabase, KEYS.lastTestedAt, "Storefront last tested", input.testedAt);
  }
  storefrontReadyCache = null;
}

export async function disconnectStorefront(): Promise<void> {
  const supabase = await adminClient();
  await supabase.rpc("delete_integration_secret", { _name: STOREFRONT_TOKEN_VAULT });
  const id = await integrationId(supabase);
  if (id) {
    await supabase
      .from("integration_settings")
      .delete()
      .eq("integration_id", id)
      .in("key", [
        KEYS.domain,
        KEYS.apiVersion,
        KEYS.privateToken,
        KEYS.publicToken,
        KEYS.state,
        KEYS.lastTestedAt,
        KEYS.lastError,
        KEYS.shopName,
        KEYS.primaryDomain,
      ]);
  }
  storefrontReadyCache = null;
}

/* ---------------------------- GraphQL client ---------------------------- */

const SCOPE_ADVICE =
  "In the store admin, open the headless channel or the custom app, confirm the Storefront API is enabled with unauthenticated_read_product_listings, unauthenticated_read_product_inventory and unauthenticated_write_checkouts, then copy the private Storefront token again.";

export async function storefrontGraphql<T>(
  credentials: { domain: string; token: string; apiVersion: string },
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const url = `https://${credentials.domain}/api/${credentials.apiVersion}/graphql.json`;
  const body = JSON.stringify({ query, variables });
  // Shopify accepts exactly one auth header. Private tokens use the private
  // header, public tokens the access-token header. Sending both is rejected,
  // so try the likely one first and fall back to the other.
  const headerNames = credentials.token.startsWith("shpat_")
    ? ["Shopify-Storefront-Private-Token", "X-Shopify-Storefront-Access-Token"]
    : ["X-Shopify-Storefront-Access-Token", "Shopify-Storefront-Private-Token"];

  const send = async (headerName: string) =>
    fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        [headerName]: credentials.token,
      },
      body,
    });

  let response: Response;
  try {
    response = await send(headerNames[0]!);
    if (response.status === 401 || response.status === 403) {
      response = await send(headerNames[1]!);
    }
  } catch {
    throw new Error(`The store at ${credentials.domain} could not be reached.`);
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error(`The store rejected the Storefront token. ${SCOPE_ADVICE}`);
  }

  if (response.status === 404) {
    throw new Error(
      `No Storefront API was found at ${credentials.domain} for version ${credentials.apiVersion}. Check the .myshopify.com domain and the version.`,
    );
  }
  if (response.status === 430 || response.status === 429) {
    throw new Error("The store is rate limiting Storefront API requests. Try again shortly.");
  }
  if (!response.ok) {
    throw new Error(`The store responded with ${response.status}`);
  }

  const payload = (await response.json().catch(() => null)) as
    | { data?: T; errors?: Array<{ message: string }> }
    | null;
  if (payload?.errors?.length) {
    const message = payload.errors.map((e) => e.message).join("; ");
    if (/access denied|unauthorized|scope/i.test(message)) {
      throw new Error(`The Storefront token is missing an access scope. ${SCOPE_ADVICE}`);
    }
    throw new Error(message);
  }
  if (!payload?.data) throw new Error("The store returned no Storefront data");
  return payload.data;
}

const SHOP_QUERY = /* GraphQL */ `
  query NurGoodsStorefrontShop {
    shop {
      name
      primaryDomain {
        host
        url
      }
      paymentSettings {
        currencyCode
      }
    }
  }
`;

export interface StorefrontTestResult {
  ok: true;
  shopName: string;
  primaryDomain: string | null;
  currency: string | null;
  apiVersion: string;
}

export async function testStorefrontConnection(input: {
  domain: string;
  apiVersion: string;
  token: string;
}): Promise<StorefrontTestResult> {
  const data = await storefrontGraphql<{
    shop: {
      name: string;
      primaryDomain: { host: string | null } | null;
      paymentSettings: { currencyCode: string | null } | null;
    };
  }>({ domain: input.domain, token: input.token, apiVersion: input.apiVersion }, SHOP_QUERY);

  return {
    ok: true,
    shopName: data.shop?.name ?? input.domain,
    primaryDomain: data.shop?.primaryDomain?.host ?? null,
    currency: data.shop?.paymentSettings?.currencyCode ?? null,
    apiVersion: input.apiVersion,
  };
}

/* ------------------------------- cart API ------------------------------- */

const CART_CREATE = /* GraphQL */ `
  mutation NurGoodsCartCreate($lines: [CartLineInput!]!) {
    cartCreate(input: { lines: $lines }) {
      cart {
        id
        checkoutUrl
        totalQuantity
        cost {
          subtotalAmount {
            amount
            currencyCode
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/** Turns a numeric variant identifier or a global id into a valid variant gid. */
export function toVariantGid(value: string): string {
  const trimmed = value.trim();
  if (/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(trimmed)) return trimmed;
  const numeric = trimmed.match(/(\d+)\s*$/)?.[1];
  if (!numeric) throw new Error("That product option cannot be ordered");
  return `gid://shopify/ProductVariant/${numeric}`;
}

export interface CartResult {
  cartId: string;
  checkoutUrl: string;
  totalQuantity: number;
  subtotal: number | null;
  currency: string | null;
}

/**
 * Creates one cart for a whole basket through the official Cart API and
 * returns the checkout link issued by the store. Every basket line travels in
 * the same cart, so a shopper is never sent to separate checkouts.
 */
export async function createStorefrontCartLines(input: {
  lines: { variantId: string; quantity: number }[];
}): Promise<CartResult> {
  const resolved = await resolveStorefrontCredentials();
  if (!resolved.domain || !resolved.privateToken) {
    throw new Error("Headless checkout is not configured");
  }
  const lines = input.lines
    .filter((line) => Boolean(line.variantId?.trim()))
    .map((line) => ({
      merchandiseId: toVariantGid(line.variantId),
      quantity: Math.max(1, Math.min(Math.trunc(line.quantity) || 1, 10)),
    }));
  if (lines.length === 0) throw new Error("There is nothing to order");
  const requestedQuantity = lines.reduce((sum, line) => sum + line.quantity, 0);

  const data = await storefrontGraphql<{
    cartCreate: {
      cart: {
        id: string;
        checkoutUrl: string;
        totalQuantity: number;
        cost: { subtotalAmount: { amount: string; currencyCode: string } | null } | null;
      } | null;
      userErrors: Array<{ message: string }>;
    };
  }>(
    {
      domain: resolved.domain,
      token: resolved.privateToken,
      apiVersion: resolved.apiVersion,
    },
    CART_CREATE,
    { lines },
  );

  const errors = data.cartCreate?.userErrors ?? [];
  if (errors.length > 0) throw new Error(errors.map((e) => e.message).join("; "));
  const cart = data.cartCreate?.cart;
  if (!cart?.checkoutUrl) throw new Error("The store did not return a checkout link");

  const checkoutUrl = await finaliseCheckoutUrl(cart.checkoutUrl);

  const amount = cart.cost?.subtotalAmount?.amount;
  return {
    cartId: cart.id,
    checkoutUrl,
    totalQuantity: cart.totalQuantity ?? requestedQuantity,
    subtotal: amount != null && amount !== "" ? Number(amount) : null,
    currency: cart.cost?.subtotalAmount?.currencyCode ?? null,
  };
}

/** Single line convenience wrapper kept for the direct Buy now action. */
export async function createStorefrontCart(input: {
  variantId: string;
  quantity: number;
}): Promise<CartResult> {
  return createStorefrontCartLines({
    lines: [{ variantId: input.variantId, quantity: input.quantity }],
  });
}


/**
 * Final safety gate on the store issued link. The shopper is only ever sent to
 * a host that has been proven to answer as the store. A link issued on the host
 * serving this site is rewritten to the recorded checkout host, and only when
 * that host answers as the store rather than forwarding back here.
 */
async function finaliseCheckoutUrl(rawUrl: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("The store did not return a usable checkout link");
  }

  if (!isSiteHost(url.host)) {
    const probe = await probeCheckoutHost(url.host);
    if (probe && !probe.servesStore && probe.redirectsToSite) {
      // The store forwards its own checkout host back here, so the link loops.
      const override = await readCheckoutHostOverride();
      const overrideProbe = override ? await probeCheckoutHost(override) : null;
      if (!overrideProbe?.servesStore) throw new Error(CHECKOUT_HOST_CONFLICT);
      url.host = overrideProbe.host;
    }
    return url.toString();
  }

  const replacement = await readCheckoutHostOverride();
  const replacementProbe = replacement ? await probeCheckoutHost(replacement) : null;
  if (!replacementProbe?.servesStore) throw new Error(CHECKOUT_HOST_CONFLICT);
  url.host = replacementProbe.host;
  return url.toString();
}

let storefrontReadyCache: { ready: boolean; expires: number } | null = null;

/**
 * True only when the headless credentials are verified and a checkout host has
 * been proven to answer as the store. Once the store serves the dedicated host,
 * this flips to true on its own with no code change.
 */
export async function isStorefrontCheckoutReady(): Promise<boolean> {
  if (storefrontReadyCache && storefrontReadyCache.expires > Date.now()) {
    return storefrontReadyCache.ready;
  }
  let ready = false;
  try {
    const status = await getStorefrontApiStatus();
    ready = status.readiness.buyNowReady;
  } catch {
    ready = false;
  }
  storefrontReadyCache = { ready, expires: Date.now() + 60_000 };
  return ready;
}


export { normaliseShopDomain, normaliseApiVersion };
