import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { StorefrontApiStatus, StorefrontTestResult } from "./shopify-storefront.server";

async function assertAdmin(context: any): Promise<void> {
  const { data: isAdmin } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!isAdmin) throw new Error("Forbidden");
}

/** Reports headless connection state. No token value is ever returned. */
export const getStorefrontApiStatusFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StorefrontApiStatus> => {
    await assertAdmin(context);
    const { getStorefrontApiStatus } = await import("./shopify-storefront.server");
    return getStorefrontApiStatus();
  });

const saveSchema = z.object({
  domain: z.string().min(3).max(255),
  apiVersion: z.string().max(20).optional(),
  privateToken: z.string().min(10).max(500).optional(),
  publicToken: z.string().max(500).optional(),
});

/** Validates the credentials against the store, then stores the token in the vault. */
export const connectStorefrontApi = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => saveSchema.parse(data))
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }): Promise<StorefrontTestResult> => {
    await assertAdmin(context);
    const {
      normaliseShopDomain,
      normaliseApiVersion,
      resolveStorefrontCredentials,
      testStorefrontConnection,
      saveStorefrontCredentials,
      markStorefrontState,
    } = await import("./shopify-storefront.server");
    const { recordSyncEvent } = await import("./shopify.server");

    const domain = normaliseShopDomain(data.domain);
    const apiVersion = normaliseApiVersion(data.apiVersion ?? null);
    const existing = await resolveStorefrontCredentials();
    const token = data.privateToken?.trim() || existing.privateToken;
    if (!token) throw new Error("A private Storefront API token is required");

    try {
      const result = await testStorefrontConnection({ domain, apiVersion, token });
      await saveStorefrontCredentials({
        domain,
        apiVersion,
        privateToken: data.privateToken?.trim() || null,
        ...(data.publicToken !== undefined ? { publicToken: data.publicToken } : {}),
        shopName: result.shopName,
      });
      await markStorefrontState({
        state: "connected",
        error: null,
        testedAt: new Date().toISOString(),
      });
      await recordSyncEvent(context.supabase, {
        eventType: "storefront_connection_test",
        status: "success",
        message: `Headless checkout verified with ${result.shopName} on Storefront API ${apiVersion}.`,
        payload: { domain, api_version: apiVersion },
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Storefront connection failed";
      await markStorefrontState({
        state: "error",
        error: message,
        testedAt: new Date().toISOString(),
      });
      await recordSyncEvent(context.supabase, {
        eventType: "storefront_connection_test",
        status: "failed",
        message,
        payload: { domain, api_version: apiVersion },
      });
      throw new Error(message);
    }
  });

/** Retests the stored headless credentials without changing them. */
export const testStorefrontApiFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StorefrontTestResult> => {
    await assertAdmin(context);
    const { resolveStorefrontCredentials, testStorefrontConnection, markStorefrontState } =
      await import("./shopify-storefront.server");
    const { recordSyncEvent } = await import("./shopify.server");

    const resolved = await resolveStorefrontCredentials();
    if (!resolved.domain || !resolved.privateToken) {
      throw new Error("Storefront credentials are not configured");
    }
    try {
      const result = await testStorefrontConnection({
        domain: resolved.domain,
        apiVersion: resolved.apiVersion,
        token: resolved.privateToken,
      });
      await markStorefrontState({
        state: "connected",
        error: null,
        testedAt: new Date().toISOString(),
      });
      await recordSyncEvent(context.supabase, {
        eventType: "storefront_connection_test",
        status: "success",
        message: `Headless checkout verified with ${result.shopName}.`,
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Storefront connection failed";
      await markStorefrontState({
        state: "error",
        error: message,
        testedAt: new Date().toISOString(),
      });
      await recordSyncEvent(context.supabase, {
        eventType: "storefront_connection_test",
        status: "failed",
        message,
      });
      throw new Error(message);
    }
  });

/** Removes the stored Storefront token and settings. Catalogue data stays. */
export const disconnectStorefrontFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: true }> => {
    await assertAdmin(context);
    const { disconnectStorefront, markStorefrontState } = await import(
      "./shopify-storefront.server"
    );
    const { recordSyncEvent } = await import("./shopify.server");
    await disconnectStorefront();
    await markStorefrontState({ state: "not_connected", error: null });
    await recordSyncEvent(context.supabase, {
      eventType: "storefront_connection_removed",
      status: "success",
      message: "Headless checkout credentials were removed from the platform.",
    });
    return { ok: true };
  });

/**
 * Public purchase action. The variant must already exist in the mirrored
 * catalogue, and only the store issued checkout link is returned.
 */
export const createCheckoutFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) =>
    z
      .object({
        variantId: z.string().min(1).max(120),
        quantity: z.number().int().min(1).max(10).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data }): Promise<{ checkoutUrl: string; totalQuantity: number }> => {
    const { createStorefrontCart, toVariantGid } = await import("./shopify-storefront.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const gid = toVariantGid(data.variantId);
    const numeric = gid.split("/").pop()!;
    const { data: variant } = await supabaseAdmin
      .from("shopify_product_variants")
      .select("shopify_variant_id")
      .like("shopify_variant_id", `%${numeric}`)
      .maybeSingle();
    if (!variant) throw new Error("That product option is no longer available");

    const cart = await createStorefrontCart({
      variantId: gid,
      quantity: data.quantity ?? 1,
    });
    return { checkoutUrl: cart.checkoutUrl, totalQuantity: cart.totalQuantity };
  });
