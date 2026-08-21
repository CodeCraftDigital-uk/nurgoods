import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type {
  ApplyPricingResult,
  AuditStatus,
  PriceRevision,
  PricingAuditItem,
  PricingAuditRun,
} from "./types";

async function assertAdmin(context: { supabase: any; userId: string }): Promise<void> {
  const { data: isAdmin } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!isAdmin) throw new Error("Forbidden");
}

export interface PricingAuditView {
  run: PricingAuditRun | null;
  items: PricingAuditItem[];
  revisions: PriceRevision[];
  costCoverage: { variants: number; withCost: number; lastSyncedAt: string | null };
}

export const getPricingAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { runId?: string; status?: string } | undefined) => input ?? {})
  .handler(async ({ data, context }): Promise<PricingAuditView> => {
    await assertAdmin(context);
    const { zendropAdminClient } = await import("../zendrop/client.server");
    const supabase = await zendropAdminClient();

    let run: any = null;
    if (data.runId) {
      const { data: row } = await supabase
        .from("pricing_audit_runs")
        .select("*")
        .eq("id", data.runId)
        .maybeSingle();
      run = row;
    } else {
      const { data: rows } = await supabase
        .from("pricing_audit_runs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1);
      run = (rows ?? [])[0] ?? null;
    }

    let items: any[] = [];
    if (run) {
      let query = supabase
        .from("pricing_audit_items")
        .select("*")
        .eq("run_id", run.id)
        .order("product_title", { ascending: true })
        .limit(600);
      if (data.status && data.status !== "all") query = query.eq("status", data.status);
      const { data: rows } = await query;
      items = rows ?? [];
    }

    const { data: revisions } = await supabase
      .from("product_price_revisions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    const { count: variants } = await supabase
      .from("shopify_product_variants")
      .select("id", { count: "exact", head: true });
    const { count: withCost } = await supabase
      .from("shopify_product_variants")
      .select("id", { count: "exact", head: true })
      .not("unit_cost", "is", null);
    const { data: latestCost } = await supabase
      .from("shopify_product_variants")
      .select("cost_synced_at")
      .not("cost_synced_at", "is", null)
      .order("cost_synced_at", { ascending: false })
      .limit(1);

    return {
      run: run as PricingAuditRun | null,
      items: items as PricingAuditItem[],
      revisions: (revisions ?? []) as PriceRevision[],
      costCoverage: {
        variants: variants ?? 0,
        withCost: withCost ?? 0,
        lastSyncedAt: ((latestCost ?? [])[0] as any)?.cost_synced_at ?? null,
      },
    };
  });

export const syncVariantCostsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { syncVariantCosts } = await import("./cost-sync.server");
    return syncVariantCosts();
  });

export const recoverSupplierLinkageFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { recoverSupplierLinkage } = await import("./linkage.server");
    return recoverSupplierLinkage();
  });

/**
 * Read only supplier shipping refresh. It quotes the configured market and
 * records the service and timestamp. It never creates or confirms an order.
 */
export const refreshShippingQuotesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { limit?: number } | undefined) => input ?? {})
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { refreshShippingQuotes } = await import("./shipping-quotes.server");
    return refreshShippingQuotes({ limit: data.limit });
  });


export const runPricingAuditFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { runPricingAudit } = await import("./audit.server");
    return runPricingAudit(context.userId);
  });

export const applyPricingAuditFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { runId: string; itemIds?: string[] }) => {
    if (!input?.runId) throw new Error("A reviewed audit run is required");
    return input;
  })
  .handler(async ({ data, context }): Promise<ApplyPricingResult> => {
    await assertAdmin(context);
    const { applyPricingAudit } = await import("./apply.server");
    return applyPricingAudit({
      runId: data.runId,
      itemIds: data.itemIds,
      userId: context.userId,
    });
  });

/**
 * Read only view of who owns the advertised price for each variant, how the
 * store compares, and whether any correction is outstanding.
 */
export const getPriceAuthorityStatusFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { zendropAdminClient } = await import("../zendrop/client.server");
    const supabase = await zendropAdminClient();
    const { data } = await supabase
      .from("product_price_authority")
      .select(
        "shopify_variant_id, variant_title, expected_price, observed_shopify_price, push_state, hold_reason, last_pushed_at, last_push_status, last_push_error, push_attempts, next_attempt_at, formula_version, landed_cost_verified_at",
      )
      .order("push_state", { ascending: true })
      .limit(500);
    const rows = (data ?? []) as any[];
    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.push_state] = (counts[row.push_state] ?? 0) + 1;
    const { verifyPriceParity } = await import("./authority.server");
    const parity = await verifyPriceParity();
    return { rows, counts, parity };
  });

/** Recalculates the NUR GOODS price and corrects the store in one bounded pass. */
export const runPriceAuthorityCycleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { runPriceAuthorityCycle } = await import("./authority.server");
    return runPriceAuthorityCycle({ pushLimit: 60 });
  });

/**
 * The pricing publication lifecycle summary: how many products are pending,
 * being processed, verified, held for missing cost or in error, with the most
 * recent reasons and outcomes.
 */
export const getPricingLifecycleStatusFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { zendropAdminClient } = await import("../zendrop/client.server");
    const supabase = await zendropAdminClient();
    const { data } = await supabase.rpc("pricing_lifecycle_stats" as never);
    return (data ?? null) as Record<string, any> | null;
  });

/** Runs a bounded lifecycle retry pass for whatever is pending, held or in error. */
export const runPricingLifecycleRetriesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { runPricingLifecycleRetries } = await import("./lifecycle.server");
    return runPricingLifecycleRetries(15);
  });

export type { AuditStatus };

