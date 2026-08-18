import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  resolveFreeShippingMarkets,
  resolveSupportedMarkets,
} from "@/lib/pricing/markets";
import type {
  CandidateRow,
  CatalogueSearchResult,
  PricingSettings,
  RateLimitSnapshot,
  SourcingCounters,
  SourcingRules,
  ZendropConnectionStatus,
} from "./types";

async function assertAdmin(context: { supabase: any; userId: string }): Promise<void> {
  const { data: isAdmin } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!isAdmin) throw new Error("Forbidden");
}

/* ------------------------------- connection ------------------------------- */

export const getZendropConnection = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ZendropConnectionStatus> => {
    await assertAdmin(context);
    const { getZendropStatus } = await import("./connection.server");
    return getZendropStatus();
  });

export const connectZendropFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { token: string; expiresOn?: string }) => {
    if (!input?.token?.trim()) throw new Error("A supplier token is required");
    return input;
  })
  .handler(async ({ data, context }): Promise<ZendropConnectionStatus> => {
    await assertAdmin(context);
    const { connectZendrop } = await import("./connection.server");
    return connectZendrop({ token: data.token, expiresOn: data.expiresOn ?? null });
  });

export const testZendropFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ZendropConnectionStatus> => {
    await assertAdmin(context);
    const { testZendropConnection } = await import("./connection.server");
    return testZendropConnection();
  });

export const disconnectZendropFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ZendropConnectionStatus> => {
    await assertAdmin(context);
    const { disconnectZendrop } = await import("./connection.server");
    return disconnectZendrop();
  });

/* -------------------------------- overview -------------------------------- */

export interface SourcingOverview {
  connection: ZendropConnectionStatus;
  pricing: PricingSettings;
  rules: SourcingRules;
  counters: SourcingCounters;
  rateLimit: RateLimitSnapshot;
  candidates: CandidateRow[];
}

export const getSourcingOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { state?: string } | undefined) => input ?? {})
  .handler(async ({ data, context }): Promise<SourcingOverview> => {
    await assertAdmin(context);
    const { getZendropStatus } = await import("./connection.server");
    const { loadCounters, loadPricingSettings, loadSourcingRules } = await import("./import.server");
    const { rateLimitSnapshot, zendropAdminClient } = await import("./client.server");

    const supabase = await zendropAdminClient();
    let query = supabase
      .from("zendrop_import_candidates")
      .select(
        "id, zendrop_product_id, title, image_url, category, state, hold_reason, failure_reason, is_test, currency, supplier_cost, shipping_cost, landed_cost, calculated_price, suggested_retail, gross_margin, pricing_complete, shopify_product_id, attempts, created_at, updated_at",
      )
      .order("created_at", { ascending: false })
      .limit(100);
    if (data.state && data.state !== "all") query = query.eq("state", data.state);
    const { data: candidates } = await query;

    return {
      connection: await getZendropStatus(),
      pricing: await loadPricingSettings(),
      rules: await loadSourcingRules(),
      counters: await loadCounters(),
      rateLimit: rateLimitSnapshot(),
      candidates: (candidates ?? []) as unknown as CandidateRow[],
    };
  });

/* -------------------------------- settings -------------------------------- */

export const updatePricingSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: Partial<PricingSettings>) => input ?? {})
  .handler(async ({ data, context }): Promise<PricingSettings> => {
    await assertAdmin(context);
    const { zendropAdminClient } = await import("./client.server");
    const { loadPricingSettings } = await import("./import.server");
    const patch: Record<string, unknown> = {};
    if (typeof data.target_margin === "number") {
      if (data.target_margin <= 0 || data.target_margin >= 1) {
        throw new Error("The target gross margin must sit between 1 and 99 percent");
      }
      patch["target_margin"] = data.target_margin;
    }
    if (typeof data.min_promo_margin === "number") patch["min_promo_margin"] = data.min_promo_margin;
    if (typeof data.promo_discount === "number") patch["promo_discount"] = data.promo_discount;
    if (data.rounding_mode) patch["rounding_mode"] = data.rounding_mode;
    if (data.shipping_market) patch["shipping_market"] = data.shipping_market;
    if (data.currency) patch["currency"] = data.currency;
    if (typeof data.allow_incomplete_pricing === "boolean") {
      patch["allow_incomplete_pricing"] = data.allow_incomplete_pricing;
    }
    if (typeof data.fx_buffer_pct === "number") {
      if (data.fx_buffer_pct < 0 || data.fx_buffer_pct >= 1) {
        throw new Error("The exchange rate buffer must sit between 0 and 99 percent");
      }
      patch["fx_buffer_pct"] = data.fx_buffer_pct;
    }
    if (data.fx_source) patch["fx_source"] = data.fx_source;
    if (typeof data.fx_quote_max_age_hours === "number") {
      patch["fx_quote_max_age_hours"] = Math.max(1, Math.trunc(data.fx_quote_max_age_hours));
    }
    if (typeof data.shipping_quote_max_age_days === "number") {
      patch["shipping_quote_max_age_days"] = Math.max(
        1,
        Math.trunc(data.shipping_quote_max_age_days),
      );
    }
    if (typeof data.payment_fee_variable === "number") {
      if (data.payment_fee_variable < 0 || data.payment_fee_variable >= 1) {
        throw new Error("The payment fee percentage must sit between 0 and 99 percent");
      }
      patch["payment_fee_variable"] = data.payment_fee_variable;
    }
    if (typeof data.payment_fee_fixed === "number") {
      if (data.payment_fee_fixed < 0) {
        throw new Error("The fixed payment fee cannot be negative");
      }
      patch["payment_fee_fixed"] = data.payment_fee_fixed;
    }
    if (data.free_shipping_market) patch["free_shipping_market"] = data.free_shipping_market;
    if (data.supported_markets) {
      const supported = resolveSupportedMarkets(data.supported_markets);
      patch["supported_markets"] = supported;
      patch["free_shipping_markets"] = resolveFreeShippingMarkets(
        data.free_shipping_markets ?? supported,
        supported,
      );
    } else if (data.free_shipping_markets) {
      const current = await loadPricingSettings();
      patch["free_shipping_markets"] = resolveFreeShippingMarkets(
        data.free_shipping_markets,
        resolveSupportedMarkets(current.supported_markets),
      );
    }

    if (Object.keys(patch).length > 0) {
      const supabase = await zendropAdminClient();
      await supabase.from("zendrop_pricing_settings").update(patch as never).eq("id", "default");
    }
    return loadPricingSettings();
  });

export const updateSourcingRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: Partial<SourcingRules>) => input ?? {})
  .handler(async ({ data, context }): Promise<SourcingRules> => {
    await assertAdmin(context);
    const { zendropAdminClient } = await import("./client.server");
    const { loadSourcingRules } = await import("./import.server");
    const allowed: Array<keyof SourcingRules> = [
      "enabled",
      "allowed_categories",
      "blocked_categories",
      "require_stock",
      "require_image",
      "require_uk_shipping",
      "duplicate_precheck",
      "min_landed_cost",
      "max_landed_cost",
      "max_retail_price",
      "daily_import_cap",
      "batch_size",
    ];
    const patch: Record<string, unknown> = {};
    for (const key of allowed) {
      if (data[key] !== undefined) patch[key] = data[key];
    }
    if (Object.keys(patch).length > 0) {
      const supabase = await zendropAdminClient();
      await supabase.from("zendrop_sourcing_rules").update(patch as never).eq("id", "default");
    }
    return loadSourcingRules();
  });

/* -------------------------------- catalogue ------------------------------- */

export const searchSupplierCatalogue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { query?: string; category?: string; page?: number; cursor?: string | null; limit?: number }) =>
      input ?? {},
  )
  .handler(async ({ data, context }): Promise<CatalogueSearchResult> => {
    await assertAdmin(context);
    const { getZendropStatus } = await import("./connection.server");
    const status = await getZendropStatus();
    if (!status.configured) {
      return {
        items: [],
        nextCursor: null,
        page: data.page ?? 1,
        total: null,
        available: false,
        message: "The supplier account is not connected yet.",
      };
    }
    const { searchZendropCatalogue } = await import("./catalogue.server");
    try {
      return await searchZendropCatalogue(data);
    } catch (cause) {
      return {
        items: [],
        nextCursor: null,
        page: data.page ?? 1,
        total: null,
        available: false,
        message: cause instanceof Error ? cause.message : "The supplier catalogue could not be read",
      };
    }
  });

/* ---------------------------------- import -------------------------------- */

export const selectForImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { productIds: string[] }) => {
    if (!Array.isArray(input?.productIds) || input.productIds.length === 0) {
      throw new Error("Select at least one supplier product");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { selectCandidates } = await import("./import.server");
    return selectCandidates({ productIds: data.productIds, userId: context.userId });
  });

export const queueForImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { candidateIds: string[] }) => {
    if (!Array.isArray(input?.candidateIds) || input.candidateIds.length === 0) {
      throw new Error("Select at least one candidate");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { getZendropStatus } = await import("./connection.server");
    const status = await getZendropStatus();
    if (!status.massImportUnlocked) {
      throw new Error(
        "Mass import stays locked until the one product test passes and the supplier confirms an import operation.",
      );
    }
    const { queueCandidates, runImportQueue } = await import("./import.server");
    const queued = await queueCandidates(data.candidateIds);
    const outcome = await runImportQueue(Math.min(queued, 5));
    return { queued, ...outcome };
  });

export const runOneProductTestFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { productId: string }) => {
    if (!input?.productId?.trim()) throw new Error("A supplier product is required");
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { runOneProductTest } = await import("./import.server");
    return runOneProductTest({ productId: data.productId.trim(), userId: context.userId });
  });

export const reconcileImportsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { reconcileImportedCandidates } = await import("./import.server");
    return { matched: await reconcileImportedCandidates() };
  });

/* --------------------------- intelligent sourcing -------------------------- */

export const screenSupplierCatalogue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { query?: string | undefined; category?: string | undefined; target?: number | undefined } | undefined) => ({
    query: input?.query,
    category: input?.category,
    target: Math.max(1, Math.min(Number(input?.target ?? 25), 500)),
  }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { getZendropStatus } = await import("./connection.server");
    const status = await getZendropStatus();
    if (!status.configured) throw new Error("The supplier account is not connected yet.");
    const { runSourcingScreen } = await import("./import.server");
    return runSourcingScreen(data);
  });

/**
 * Queues a reviewed batch. Mass import stays locked until the controlled one
 * product test has passed, and the daily cap still applies on top of the batch
 * size, so a large batch can never bypass the pace controls.
 */
export const runSourcingBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { productIds: string[]; batchSize?: number }) => {
    if (!Array.isArray(input?.productIds) || input.productIds.length === 0) {
      throw new Error("Select at least one screened product");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { getZendropStatus } = await import("./connection.server");
    const status = await getZendropStatus();
    if (!status.massImportUnlocked) {
      throw new Error(
        "Mass import stays locked until the one product test passes and the supplier confirms an import operation.",
      );
    }
    const { queueCandidates, runImportQueue, selectCandidates } = await import("./import.server");
    const size = Math.max(1, Math.min(Number(data.batchSize ?? 25), 500));
    const selection = await selectCandidates({
      productIds: data.productIds.slice(0, size),
      userId: context.userId,
    });
    const ready = selection.candidateIds;
    const queued = await queueCandidates(ready);
    const outcome = await runImportQueue(Math.min(queued, 20));
    return { ...selection, queued, ...outcome };
  });
