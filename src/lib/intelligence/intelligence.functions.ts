import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Control plane for Catalogue Intelligence and SEO Intelligence.
 *
 * These are monitoring reads plus a small set of exception controls. Normal
 * operation is fully automatic: the sync queues work, the scheduled jobs drain
 * it, and nothing waits on a person to approve a category or a metadata field.
 */

async function assertAdmin(context: any): Promise<void> {
  const { data: isAdmin } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!isAdmin) throw new Error("Forbidden");
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as never as import("@supabase/supabase-js").SupabaseClient<any, "public", any>;
}

export interface CategoryDistributionRow {
  slug: string;
  name: string;
  parent_slug: string | null;
  products: number;
}

export interface CatalogueIntelligenceOverview {
  totals: {
    products: number;
    classified: number;
    high: number;
    medium: number;
    low: number;
    anomalies: number;
    needsAttention: number;
    duplicates: number;
    averageQuality: number;
    healthPercent: number;
  };
  backfill: { total: number; classified: number; optimised: number; queued: number; failed: number; percent: number };
  distribution: CategoryDistributionRow[];
  recentCorrections: Array<{
    id: string;
    product_title: string;
    product_handle: string;
    supplier_category: string | null;
    previous_category_slug: string | null;
    new_category_slug: string | null;
    confidence: number | null;
    reason: string | null;
    created_at: string;
  }>;
  attention: Array<{
    product_id: string;
    title: string;
    handle: string;
    category_slug: string | null;
    confidence: number;
    tier: string;
    anomalies: Array<{ code: string; label: string }>;
    quality_score: number;
  }>;
  lastRun: { at: string | null; status: string | null; message: string | null };
}

export const getCatalogueIntelligenceFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CatalogueIntelligenceOverview> => {
    await assertAdmin(context);
    const db = await admin();
    const { backfillProgress } = await import("./jobs.server");

    const [productCount, classifications, categories, history, job] = await Promise.all([
      db.from("shopify_products").select("id", { count: "exact", head: true }),
      db
        .from("product_classifications")
        .select(
          "product_id, category_slug, confidence, confidence_tier, anomaly_flags, quality_score, needs_attention, duplicate_of_product_id",
        )
        .limit(3000),
      db.from("catalogue_categories").select("slug, name, parent_id, id").limit(500),
      db
        .from("product_classification_history")
        .select("id, product_id, supplier_category, previous_category_slug, new_category_slug, confidence, reason, created_at")
        .order("created_at", { ascending: false })
        .limit(20),
      db
        .from("automation_jobs")
        .select("last_run_at, last_status, last_result")
        .eq("job_key", "catalogue_intelligence_daily")
        .maybeSingle(),
    ]);

    const rows = (classifications.data ?? []) as any[];
    const categoryRows = (categories.data ?? []) as any[];
    const byId = new Map(categoryRows.map((row) => [row.id, row]));
    const bySlug = new Map(categoryRows.map((row) => [row.slug, row]));

    const counts = new Map<string, number>();
    let high = 0;
    let medium = 0;
    let low = 0;
    let anomalies = 0;
    let duplicates = 0;
    let qualityTotal = 0;
    for (const row of rows) {
      if (row.confidence_tier === "high") high += 1;
      else if (row.confidence_tier === "medium") medium += 1;
      else low += 1;
      if (Array.isArray(row.anomaly_flags) && row.anomaly_flags.length > 0) anomalies += 1;
      if (row.duplicate_of_product_id) duplicates += 1;
      qualityTotal += row.quality_score ?? 0;
      if (row.category_slug) counts.set(row.category_slug, (counts.get(row.category_slug) ?? 0) + 1);
    }

    const total = productCount.count ?? 0;
    const needsAttention = rows.filter((row) => row.needs_attention).length;

    const distribution: CategoryDistributionRow[] = [...counts.entries()]
      .map(([slug, products]) => {
        const node = bySlug.get(slug);
        const parent = node?.parent_id ? byId.get(node.parent_id) : null;
        return {
          slug,
          name: node?.name ?? slug,
          parent_slug: parent?.slug ?? null,
          products,
        };
      })
      .sort((a, b) => b.products - a.products);

    // Attention list with product names.
    const attentionRows = rows.filter((row) => row.needs_attention).slice(0, 25);
    const historyRows = (history.data ?? []) as any[];
    const productIds = [
      ...new Set([...attentionRows.map((row) => row.product_id), ...historyRows.map((row) => row.product_id)]),
    ];
    let productsById = new Map<string, { title: string; handle: string }>();
    if (productIds.length > 0) {
      const { data } = await db.from("shopify_products").select("id, title, handle").in("id", productIds);
      productsById = new Map(((data ?? []) as any[]).map((row) => [row.id, { title: row.title, handle: row.handle }]));
    }

    const healthy = rows.filter(
      (row) => row.confidence_tier !== "low" && !row.needs_attention,
    ).length;

    return {
      totals: {
        products: total,
        classified: rows.length,
        high,
        medium,
        low,
        anomalies,
        needsAttention,
        duplicates,
        averageQuality: rows.length === 0 ? 0 : Math.round(qualityTotal / rows.length),
        healthPercent: total === 0 ? 0 : Math.round((healthy / total) * 100),
      },
      backfill: await backfillProgress(db),
      distribution,
      recentCorrections: historyRows.map((row) => ({
        id: row.id,
        product_title: productsById.get(row.product_id)?.title ?? "Unknown product",
        product_handle: productsById.get(row.product_id)?.handle ?? "",
        supplier_category: row.supplier_category,
        previous_category_slug: row.previous_category_slug,
        new_category_slug: row.new_category_slug,
        confidence: row.confidence,
        reason: row.reason,
        created_at: row.created_at,
      })),
      attention: attentionRows.map((row) => ({
        product_id: row.product_id,
        title: productsById.get(row.product_id)?.title ?? "Unknown product",
        handle: productsById.get(row.product_id)?.handle ?? "",
        category_slug: row.category_slug,
        confidence: row.confidence ?? 0,
        tier: row.confidence_tier,
        anomalies: Array.isArray(row.anomaly_flags) ? row.anomaly_flags : [],
        quality_score: row.quality_score ?? 0,
      })),
      lastRun: {
        at: (job.data as any)?.last_run_at ?? null,
        status: (job.data as any)?.last_status ?? null,
        message: (job.data as any)?.last_result?.message ?? null,
      },
    };
  });

export interface SeoIntelligenceOverview {
  totals: {
    products: number;
    optimised: number;
    valid: number;
    needsAttention: number;
    rejected: number;
    validSchemaPercent: number;
    duplicateMetadata: number;
    missingMetadata: number;
    brokenLinks: number;
    averageScore: number;
    healthPercent: number;
  };
  backfill: { total: number; classified: number; optimised: number; queued: number; failed: number; percent: number };
  issues: Array<{ code: string; label: string; count: number }>;
  recent: Array<{
    product_id: string;
    title: string;
    handle: string;
    seo_title: string | null;
    optimisation_score: number;
    validation_state: string;
    last_analysed_at: string | null;
  }>;
  lastRun: { at: string | null; status: string | null; message: string | null };
}

export const getSeoIntelligenceFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SeoIntelligenceOverview> => {
    await assertAdmin(context);
    const db = await admin();
    const { backfillProgress } = await import("./jobs.server");

    const [productCount, rowsResult, job] = await Promise.all([
      db.from("shopify_products").select("id", { count: "exact", head: true }),
      db
        .from("product_seo_intelligence")
        .select(
          "product_id, seo_title, meta_description, optimisation_score, validation_state, issues, schema_inputs, internal_links, last_analysed_at",
        )
        .order("last_analysed_at", { ascending: false })
        .limit(3000),
      db
        .from("automation_jobs")
        .select("last_run_at, last_status, last_result")
        .eq("job_key", "catalogue_intelligence_daily")
        .maybeSingle(),
    ]);

    const rows = (rowsResult.data ?? []) as any[];
    const total = productCount.count ?? 0;

    let valid = 0;
    let needsAttention = 0;
    let rejected = 0;
    let missingMetadata = 0;
    let validSchema = 0;
    let scoreTotal = 0;
    let brokenLinks = 0;
    const issueCounts = new Map<string, { label: string; count: number }>();
    const titleSeen = new Map<string, number>();

    for (const row of rows) {
      if (row.validation_state === "valid") valid += 1;
      else if (row.validation_state === "needs_attention") needsAttention += 1;
      else rejected += 1;
      if (!row.seo_title || !row.meta_description) missingMetadata += 1;
      if (row.schema_inputs?.product?.name) validSchema += 1;
      scoreTotal += row.optimisation_score ?? 0;
      if (Array.isArray(row.internal_links)) brokenLinks += 0;
      for (const issue of Array.isArray(row.issues) ? row.issues : []) {
        const entry = issueCounts.get(issue.code) ?? { label: issue.label ?? issue.code, count: 0 };
        entry.count += 1;
        issueCounts.set(issue.code, entry);
      }
      if (row.seo_title) {
        const key = String(row.seo_title).toLowerCase();
        titleSeen.set(key, (titleSeen.get(key) ?? 0) + 1);
      }
    }

    const duplicateMetadata = [...titleSeen.values()].filter((count) => count > 1).length;

    const recentIds = rows.slice(0, 15).map((row) => row.product_id);
    let productsById = new Map<string, { title: string; handle: string }>();
    if (recentIds.length > 0) {
      const { data } = await db.from("shopify_products").select("id, title, handle").in("id", recentIds);
      productsById = new Map(((data ?? []) as any[]).map((row) => [row.id, { title: row.title, handle: row.handle }]));
    }

    return {
      totals: {
        products: total,
        optimised: rows.length,
        valid,
        needsAttention,
        rejected,
        validSchemaPercent: rows.length === 0 ? 0 : Math.round((validSchema / rows.length) * 100),
        duplicateMetadata,
        missingMetadata,
        brokenLinks,
        averageScore: rows.length === 0 ? 0 : Math.round(scoreTotal / rows.length),
        healthPercent: total === 0 ? 0 : Math.round((valid / total) * 100),
      },
      backfill: await backfillProgress(db),
      issues: [...issueCounts.entries()]
        .map(([code, entry]) => ({ code, label: entry.label, count: entry.count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 12),
      recent: rows.slice(0, 15).map((row) => ({
        product_id: row.product_id,
        title: productsById.get(row.product_id)?.title ?? "Unknown product",
        handle: productsById.get(row.product_id)?.handle ?? "",
        seo_title: row.seo_title,
        optimisation_score: row.optimisation_score ?? 0,
        validation_state: row.validation_state,
        last_analysed_at: row.last_analysed_at,
      })),
      lastRun: {
        at: (job.data as any)?.last_run_at ?? null,
        status: (job.data as any)?.last_status ?? null,
        message: (job.data as any)?.last_result?.message ?? null,
      },
    };
  });

/* ------------------------------ exceptions ------------------------------ */

const actionSchema = z.object({
  action: z.enum(["backfill", "maintenance", "audit", "retry_failed"]),
});

/** Exception controls. Normal operation does not need any of these. */
export const runIntelligenceActionFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => actionSchema.parse(data))
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }): Promise<{ message: string }> => {
    await assertAdmin(context);
    const db = await admin();

    if (data.action === "retry_failed") {
      const { data: failed } = await db
        .from("intelligence_queue")
        .select("id")
        .eq("status", "failed")
        .limit(200);
      const ids = ((failed ?? []) as any[]).map((row) => row.id);
      if (ids.length === 0) return { message: "There is no failed work to retry." };
      await db
        .from("intelligence_queue")
        .update({ status: "queued", attempts: 0, locked_at: null, lock_token: null } as never)
        .in("id", ids);
      return { message: `Requeued ${ids.length} failed items.` };
    }

    const { runAutomationJob } = await import("@/lib/automation/runner.server");
    const jobKey =
      data.action === "backfill"
        ? "catalogue_intelligence_backfill"
        : data.action === "maintenance"
          ? "catalogue_intelligence_daily"
          : "catalogue_quality_audit";
    const result = await runAutomationJob({ supabase: db, userId: context.userId }, jobKey);
    return { message: result.message };
  });

const productActionSchema = z.object({
  productId: z.string().uuid(),
  stage: z.enum(["classify", "seo"]),
});

/** Forces one product back through a stage, for the rare manual exception. */
export const requeueProductFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => productActionSchema.parse(data))
  .middleware([requireSupabaseAuth])
  .handler(async ({ context, data }): Promise<{ message: string }> => {
    await assertAdmin(context);
    const db = await admin();
    const { enqueue, processQueue } = await import("./queue.server");
    await enqueue(db, [
      { productId: data.productId, stage: data.stage, reason: "Requested from the control plane", priority: 1 },
    ]);
    const processed = await processQueue(db, 2);
    return {
      message:
        processed.processed > 0
          ? "The product has been reprocessed."
          : "The product is queued and will be picked up on the next pass.",
    };
  });

export interface TaxonomyRow {
  id: string;
  slug: string;
  name: string;
  parent_slug: string | null;
  enabled: boolean;
  sort_order: number;
  products: number;
}

export const listTaxonomyFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TaxonomyRow[]> => {
    await assertAdmin(context);
    const db = await admin();
    const [{ data: categories }, { data: classifications }] = await Promise.all([
      db
        .from("catalogue_categories")
        .select("id, slug, name, parent_id, enabled, sort_order")
        .order("sort_order", { ascending: true }),
      db.from("product_classifications").select("category_slug").limit(3000),
    ]);
    const rows = (categories ?? []) as any[];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const counts = new Map<string, number>();
    for (const row of ((classifications ?? []) as any[])) {
      if (row.category_slug) counts.set(row.category_slug, (counts.get(row.category_slug) ?? 0) + 1);
    }
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      parent_slug: row.parent_id ? (byId.get(row.parent_id)?.slug ?? null) : null,
      enabled: row.enabled,
      sort_order: row.sort_order,
      products: counts.get(row.slug) ?? 0,
    }));
  });
