import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type {
  ConnectionTestResult,
  ShopifyCredentialStatus,
  SyncResult,
} from "./shopify.server";

async function assertAdmin(context: any): Promise<void> {
  const { data: isAdmin } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!isAdmin) throw new Error("Forbidden");
}

/** Reports connection state. No secret value is ever returned. */
export const getShopifyStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ShopifyCredentialStatus> => {
    await assertAdmin(context);
    const { getShopifyCredentialStatus } = await import("./shopify.server");
    return getShopifyCredentialStatus();
  });

const credentialsSchema = z.object({
  shopDomain: z.string().min(3).max(255),
  apiVersion: z.string().max(20).optional(),
  clientId: z.string().min(6).max(255).optional(),
  clientSecret: z.string().min(6).max(500).optional(),
});

/** Validates against the store, then stores the client secret in the vault. */
export const connectShopify = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => credentialsSchema.parse(data))
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }): Promise<ConnectionTestResult> => {
    await assertAdmin(context);
    const {
      normaliseShopDomain,
      normaliseApiVersion,
      resolveShopifyCredentials,
      testShopifyConnection,
      saveShopifyCredentials,
      markConnectionState,
      recordSyncEvent,
    } = await import("./shopify.server");

    const shopDomain = normaliseShopDomain(data.shopDomain);
    const apiVersion = normaliseApiVersion(data.apiVersion ?? null);

    const existing = await resolveShopifyCredentials();
    const clientId = data.clientId?.trim() || existing.clientId;
    const clientSecret = data.clientSecret?.trim() || existing.clientSecret;
    if (!clientId || !clientSecret) {
      throw new Error("A Client ID and Client secret are required");
    }

    try {
      const result = await testShopifyConnection({
        shopDomain,
        apiVersion,
        clientId,
        clientSecret,
      });
      await saveShopifyCredentials({
        shopDomain,
        apiVersion,
        clientId,
        clientSecret: data.clientSecret?.trim() || null,
        shopName: result.shopName,
      });
      await markConnectionState({
        state: "connected",
        error: null,
        testedAt: new Date().toISOString(),
      });
      await recordSyncEvent(context.supabase, {
        eventType: "connection_test",
        status: "success",
        message: `Connected to ${result.shopName} on Admin API ${apiVersion}.`,
        payload: { shop_domain: shopDomain, api_version: apiVersion },
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Connection failed";
      await markConnectionState({
        state: "error",
        error: message,
        testedAt: new Date().toISOString(),
      });
      await recordSyncEvent(context.supabase, {
        eventType: "connection_test",
        status: "failed",
        message,
        payload: { shop_domain: shopDomain, api_version: apiVersion },
      });
      throw new Error(message);
    }
  });

/** Retests the stored credentials without changing them. */
export const testShopifyConnectionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ConnectionTestResult> => {
    await assertAdmin(context);
    const {
      resolveShopifyCredentials,
      testShopifyConnection,
      markConnectionState,
      recordSyncEvent,
    } = await import("./shopify.server");

    const resolved = await resolveShopifyCredentials();
    if (!resolved.shopDomain || resolved.missing.length > 0) {
      throw new Error(`Store credentials missing: ${resolved.missing.join(", ")}`);
    }
    try {
      const result = await testShopifyConnection({
        shopDomain: resolved.shopDomain,
        apiVersion: resolved.apiVersion,
        clientId: resolved.clientId,
        clientSecret: resolved.clientSecret,
        adminToken: resolved.adminToken,
      });
      await markConnectionState({
        state: "connected",
        error: null,
        testedAt: new Date().toISOString(),
      });
      await recordSyncEvent(context.supabase, {
        eventType: "connection_test",
        status: "success",
        message: `Connection verified with ${result.shopName}.`,
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Connection failed";
      await markConnectionState({
        state: "error",
        error: message,
        testedAt: new Date().toISOString(),
      });
      await recordSyncEvent(context.supabase, {
        eventType: "connection_test",
        status: "failed",
        message,
      });
      throw new Error(message);
    }
  });


/** Removes the stored token and configuration. Mirrored catalogue data stays. */
export const disconnectShopifyFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: true }> => {
    await assertAdmin(context);
    const { disconnectShopify, recordSyncEvent } = await import("./shopify.server");
    await disconnectShopify();
    await recordSyncEvent(context.supabase, {
      eventType: "connection_removed",
      status: "success",
      message: "Store credentials were removed from the platform.",
    });
    return { ok: true };
  });

/** Mirrors store products and collections read only. The store stays authoritative. */
export const runShopifyCatalogueSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SyncResult> => {
    await assertAdmin(context);
    const { syncCatalogue, recordSyncEvent, markConnectionState, isTransientShopifyError } =
      await import("./shopify.server");

    try {
      const result = await syncCatalogue(context.supabase);
      await recordSyncEvent(context.supabase, {
        status: "success",
        message: `Mirrored ${result.products} products, ${result.variants} variants and ${result.collections} collections.`,
        payload: {
          products: result.products,
          collections: result.collections,
          variants: result.variants,
          media: result.media,
        },
      });
      await markConnectionState({
        state: "connected",
        error: null,
        syncedAt: result.syncedAt,
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Catalogue sync failed";
      await recordSyncEvent(context.supabase, { status: "failed", message });
      // Rate limits and upstream hiccups do not mean the store connection is
      // broken, so the state stays connected and only the note is recorded.
      await markConnectionState({
        state: isTransientShopifyError(message) ? "connected" : "error",
        error: message,
      });
      throw new Error(message);
    }
  });


/**
 * Mirrors the store's native policies and published pages. The store remains
 * authoritative for this wording. Nothing is written back to the store.
 */
export const runShopifyLegalSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { recordSyncEvent } = await import("./shopify.server");
    const { syncLegalContent, LEGAL_SCOPE_ACTION } = await import("./shopify-legal.server");

    try {
      const result = await syncLegalContent(context.supabase);
      if (result.imported === 0 && result.scopeAction) {
        await recordSyncEvent(context.supabase, {
          eventType: "legal_sync",
          status: "failed",
          message: LEGAL_SCOPE_ACTION,
        });
        return result;
      }
      await recordSyncEvent(context.supabase, {
        eventType: "legal_sync",
        status: "success",
        message: `Imported ${result.imported} legal documents. ${result.publicVisible} are ready to publish and ${result.needsReview} need owner review.`,
        payload: {
          policies: result.policies,
          pages: result.pages,
          needs_review: result.needsReview,
        },
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Legal sync failed";
      await recordSyncEvent(context.supabase, {
        eventType: "legal_sync",
        status: "failed",
        message,
      });
      throw new Error(message);
    }
  });

/** Reads the configured checkout host used for basket links. */
export const getCheckoutDomainFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{ checkoutDomain: string | null; shopDomain: string | null; ready: boolean }> => {
      await assertAdmin(context);
      const { getCheckoutDomainSetting } = await import("./shopify.server");
      const { isCheckoutReady } = await import("@/lib/public-api/storefront.server");
      const current = await getCheckoutDomainSetting();
      const effective = current.checkoutDomain ?? current.shopDomain ?? null;
      return { ...current, ready: await isCheckoutReady(effective) };
    },
  );

/** Sets or clears the checkout host used for basket links. */
export const setCheckoutDomainFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => z.object({ checkoutDomain: z.string().max(255) }).parse(data))
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }): Promise<{ checkoutDomain: string | null }> => {
    await assertAdmin(context);
    const { setCheckoutDomainSetting, getCheckoutDomainSetting } = await import("./shopify.server");
    await setCheckoutDomainSetting(data.checkoutDomain.trim() || null);
    const current = await getCheckoutDomainSetting();
    return { checkoutDomain: current.checkoutDomain };
  });
