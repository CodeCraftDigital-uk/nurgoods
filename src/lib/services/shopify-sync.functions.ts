import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ShopifyCredentialStatus, SyncResult } from "./shopify.server";

/** Reports whether Shopify Admin API credentials exist. No secret values are returned. */
export const getShopifyStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ShopifyCredentialStatus> => {
    const { readShopifyCredentials } = await import("./shopify.server");
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { shopDomain, apiVersion, missing } = readShopifyCredentials();
    return { configured: missing.length === 0, shopDomain, apiVersion, missing };
  });

/** Mirrors Shopify products and collections read only. Shopify stays authoritative. */
export const runShopifyCatalogueSync = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SyncResult> => {
    const { syncCatalogue, recordSyncEvent } = await import("./shopify.server");
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    try {
      const result = await syncCatalogue(context.supabase);
      await recordSyncEvent(context.supabase, {
        status: "success",
        message: `Mirrored ${result.products} products and ${result.collections} collections.`,
        payload: { products: result.products, collections: result.collections },
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Catalogue sync failed";
      await recordSyncEvent(context.supabase, { status: "failed", message });
      throw new Error(message);
    }
  });
