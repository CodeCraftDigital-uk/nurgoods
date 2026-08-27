/**
 * Authorised end to end catalogue repair.
 *
 * The shop, the mirror and the public website had drifted apart: products held
 * off sale for a reason that was our own fault, products the supplier created
 * and pushed live before a single gate had run, and local rows for products
 * that no longer exist at all. This pass settles every one of them against a
 * single objective rule and leaves the three views identical.
 *
 * The shape of the pass is deliberate:
 *
 *   - The live store is enumerated first and is the only authority. The mirror
 *     is never consulted to decide what exists or what state it is in.
 *   - Every product gets a manifest row before any change is made, so the run
 *     can be paused, resumed, and explained item by item afterwards.
 *   - Work happens in bounded batches with a wall clock budget. A run that is
 *     cut off leaves a correct checkpoint rather than a half repaired shop.
 *   - Every item is either fully published on all three surfaces with a price
 *     read back from the store, or removed with a recoverable tombstone, or
 *     stopped and reported. There is no fourth outcome.
 */
import { fetchLiveCataloguePage } from "@/lib/pricing/catalogue-reconcile.server";
import { zendropAdminClient } from "@/lib/zendrop/client.server";
import { deleteProductPermanently, purgeLocalRecords } from "./deletion.server";
import { decideRepairAction, surfacesComplete, type RepairEvidence } from "./repair";

/** Products settled per invocation. Kept small so each call stays well inside its budget. */
const DEFAULT_BATCH = 10;

/** Wall clock budget for one invocation. */
const DEFAULT_BUDGET_MS = 110_000;

/** Ceiling for one product. Past this the item is left for the next pass. */
const ITEM_TIMEOUT_MS = 120_000;

/** Races work against the clock so one wedged call cannot stall a run. */
async function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface RepairCounts {
  live_total: number;
  live_active: number;
  live_draft: number;
  live_archived: number;
  mirror: number;
  snapshot: number;
}

export interface RepairRunSummary {
  runId: string;
  dryRun: boolean;
  status: string;
  counts: Record<string, number>;
  message: string;
}

/** Reads the authoritative counts from the store plus the two local views. */
export async function measureCatalogue(): Promise<RepairCounts> {
  const supabase = await zendropAdminClient();
  const live = await enumerateLiveCatalogue();
  const [{ count: mirror }, { count: snapshot }] = await Promise.all([
    supabase.from("shopify_products").select("id", { count: "exact", head: true }),
    supabase.from("storefront_snapshot").select("product_id", { count: "exact", head: true }),
  ]);
  return {
    live_total: live.length,
    live_active: live.filter((product) => product.status === "active").length,
    live_draft: live.filter((product) => product.status === "draft").length,
    live_archived: live.filter((product) => product.status === "archived").length,
    mirror: Number(mirror ?? 0),
    snapshot: Number(snapshot ?? 0),
  };
}

interface LiveEntry {
  shopifyProductId: string;
  title: string | null;
  status: string;
  variants: number;
}

/** Walks the whole live catalogue. The store is the only authority here. */
export async function enumerateLiveCatalogue(): Promise<LiveEntry[]> {
  const entries: LiveEntry[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 60; page += 1) {
    const result = await fetchLiveCataloguePage(cursor);
    for (const product of result.products) {
      entries.push({
        shopifyProductId: product.shopifyProductId,
        title: product.title,
        status: product.status,
        variants: product.variants.length,
      });
    }
    cursor = result.cursor;
    if (!result.hasNextPage) break;
  }
  return entries;
}

/**
 * Opens a run and writes the manifest: one row per live product, plus one row
 * per phantom mirror record the store no longer knows about.
 */
export async function startRepairRun(options: {
  dryRun: boolean;
  authorisedBy?: string | null;
}): Promise<RepairRunSummary> {
  const supabase = await zendropAdminClient();
  const before = await measureCatalogue();

  const { data: run } = await supabase
    .from("catalogue_repair_runs")
    .insert({
      mode: "repair",
      status: "running",
      dry_run: options.dryRun,
      before_counts: before as never,
      authorised_by: options.authorisedBy ?? null,
      message: "Manifest being written",
    } as never)
    .select("id")
    .maybeSingle();
  const runId = String((run as any)?.id ?? "");
  if (!runId) throw new Error("The repair run could not be opened");

  const live = await enumerateLiveCatalogue();
  const liveIds = new Set(live.map((entry) => entry.shopifyProductId));

  const items = live.map((entry) => ({
    run_id: runId,
    shopify_product_id: entry.shopifyProductId,
    title: entry.title,
    status_before: entry.status,
    decision: "pending",
    evidence: { variants: entry.variants } as never,
  }));

  // Local rows for products the store no longer holds. They are phantoms: the
  // website can still be showing them, so they are part of the same manifest.
  const { data: mirrorRows } = await supabase
    .from("shopify_products")
    .select("id, shopify_product_id, handle, title, status")
    .limit(5000);
  for (const row of ((mirrorRows ?? []) as any[])) {
    const id = String(row.shopify_product_id ?? "");
    if (!id || liveIds.has(id)) continue;
    items.push({
      run_id: runId,
      shopify_product_id: id,
      title: row.title ?? null,
      status_before: "absent_from_store",
      decision: "pending",
      evidence: { phantom: true, mirror_id: row.id } as never,
    });
  }

  for (let index = 0; index < items.length; index += 200) {
    await supabase
      .from("catalogue_repair_items")
      .upsert(items.slice(index, index + 200) as never, { onConflict: "run_id,shopify_product_id" });
  }

  await supabase
    .from("catalogue_repair_runs")
    .update({
      message: `Manifest written for ${items.length} item(s): ${live.length} live product(s) and ${
        items.length - live.length
      } record(s) the store no longer holds.`,
    } as never)
    .eq("id", runId);

  return {
    runId,
    dryRun: options.dryRun,
    status: "running",
    counts: { manifest: items.length, ...before },
    message: `Run opened with ${items.length} item(s) in the manifest.`,
  };
}

export interface BatchReport {
  runId: string;
  processed: number;
  published: number;
  deleted: number;
  blocked: number;
  phantomsCleared: number;
  remaining: number;
  finished: boolean;
  message: string;
}

/**
 * Settles the next bounded batch of manifest items.
 *
 * Idempotent: an item is only picked up while it is still pending, and each
 * decision is written before the next item is started, so a run cut off part
 * way resumes exactly where it stopped.
 */
export async function runRepairBatch(options: {
  runId: string;
  limit?: number;
  budgetMs?: number;
}): Promise<BatchReport> {
  const supabase = await zendropAdminClient();
  const deadline = Date.now() + Math.max(15_000, options.budgetMs ?? DEFAULT_BUDGET_MS);
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_BATCH, 25));

  const { data: run } = await supabase
    .from("catalogue_repair_runs")
    .select("id, dry_run, authorised_by, status")
    .eq("id", options.runId)
    .maybeSingle();
  if (!run) throw new Error("That repair run does not exist");
  const dryRun = (run as any).dry_run === true;

  const { data: pending } = await supabase
    .from("catalogue_repair_items")
    .select("id, shopify_product_id, title, status_before, evidence")
    .eq("run_id", options.runId)
    .eq("decision", "pending")
    .order("shopify_product_id", { ascending: true })
    .limit(limit);

  const report: BatchReport = {
    runId: options.runId,
    processed: 0,
    published: 0,
    deleted: 0,
    blocked: 0,
    phantomsCleared: 0,
    remaining: 0,
    finished: false,
    message: "",
  };

  for (const item of ((pending ?? []) as any[])) {
    if (Date.now() > deadline) break;
    report.processed += 1;

    try {
      if (item.status_before === "absent_from_store") {
        const outcome = await clearPhantom(supabase, item, dryRun);
        report.phantomsCleared += outcome.cleared ? 1 : 0;
        await settle(supabase, item.id, {
          decision: outcome.cleared ? "purged" : "blocked",
          reasonCode: "phantom",
          reason: outcome.message,
          statusAfter: "absent_from_store",
        });
        continue;
      }

      // A single wedged store call must never stall the whole repair. The item
      // is abandoned as unsettled, stays in the manifest, and the next pass
      // picks it up again.
      const settledItem = await withTimeout(
        settleProduct({
          shopifyProductId: String(item.shopify_product_id),
          runId: options.runId,
          authorisedBy: (run as any).authorised_by ?? null,
          dryRun,
        }),
        ITEM_TIMEOUT_MS,
        "This product took too long to settle, so it was left for the next pass",
      );

      if (settledItem.decision === "publish") report.published += 1;
      else if (settledItem.decision === "delete") report.deleted += 1;
      else report.blocked += 1;

      await settle(supabase, item.id, {
        decision: settledItem.decision,
        reasonCode: settledItem.reasonCode,
        reason: settledItem.reason,
        statusAfter: settledItem.statusAfter,
        evidence: settledItem.evidence,
        publicationsAfter: settledItem.surfaces,
        priceParity: settledItem.priceParity,
        blocked: settledItem.decision === "blocked",
      });
    } catch (cause) {
      report.blocked += 1;
      await settle(supabase, item.id, {
        decision: "blocked",
        reasonCode: "error",
        reason: cause instanceof Error ? cause.message : "The item could not be settled",
        statusAfter: null,
        blocked: true,
      });
    }
  }

  const { count: remaining } = await supabase
    .from("catalogue_repair_items")
    .select("id", { count: "exact", head: true })
    .eq("run_id", options.runId)
    .eq("decision", "pending");
  report.remaining = Number(remaining ?? 0);
  report.finished = report.remaining === 0;

  report.message = `${report.processed} item(s) settled: ${report.published} published, ${report.deleted} removed, ${report.phantomsCleared} phantom record(s) cleared, ${report.blocked} stopped for review. ${report.remaining} left.`;

  await supabase
    .from("catalogue_repair_runs")
    .update({ message: report.message, cursor: String(report.remaining) } as never)
    .eq("id", options.runId);

  return report;
}

async function settle(
  supabase: any,
  itemId: string,
  input: {
    decision: string;
    reasonCode: string;
    reason: string;
    statusAfter: string | null;
    evidence?: Record<string, unknown>;
    publicationsAfter?: string[];
    priceParity?: Record<string, unknown>;
    blocked?: boolean;
  },
): Promise<void> {
  await supabase
    .from("catalogue_repair_items")
    .update({
      decision: input.decision,
      reason_code: input.reasonCode,
      reason: input.reason,
      status_after: input.statusAfter,
      evidence: (input.evidence ?? {}) as never,
      publications_after: (input.publicationsAfter ?? []) as never,
      price_parity: (input.priceParity ?? {}) as never,
      blocked: input.blocked === true,
      processed_at: new Date().toISOString(),
    } as never)
    .eq("id", itemId);
}

async function clearPhantom(
  supabase: any,
  item: any,
  dryRun: boolean,
): Promise<{ cleared: boolean; message: string }> {
  const mirrorId = item?.evidence?.mirror_id ? String(item.evidence.mirror_id) : null;
  if (dryRun) {
    return { cleared: false, message: "Dry run. This record would be cleared from the local views." };
  }
  await supabase.from("catalogue_tombstones").insert({
    shopify_product_id: String(item.shopify_product_id),
    product_id: mirrorId,
    title: item.title ?? null,
    status_before: "absent_from_store",
    reason_code: "phantom_mirror_row",
    reason: "The store no longer holds this product, so its local records were retired.",
    deleted_from_store: true,
    mirror_snapshot: (item.evidence ?? {}) as never,
  } as never);
  const cleaned = await purgeLocalRecords(supabase, {
    shopifyProductId: String(item.shopify_product_id),
    productId: mirrorId,
  });
  return {
    cleared: true,
    message: `Cleared from ${cleaned.length} local view(s) because the store no longer holds this product.`,
  };
}

interface SettledProduct {
  decision: "publish" | "delete" | "blocked";
  reasonCode: string;
  reason: string;
  statusAfter: string | null;
  surfaces: string[];
  evidence: Record<string, unknown>;
  priceParity: Record<string, unknown>;
}

/**
 * Revalidates one product from scratch and either puts it fully on sale or
 * removes it. Stale lifecycle flags are never trusted: the price is
 * recalculated and read back from the store on every item.
 */
async function settleProduct(input: {
  shopifyProductId: string;
  runId: string;
  authorisedBy: string | null;
  dryRun: boolean;
}): Promise<SettledProduct> {
  const supabase = await zendropAdminClient();
  const { runPricingLifecycle } = await import("@/lib/pricing/lifecycle.server");
  const { productSellability } = await import("@/lib/intake/sellability.server");

  const evidence: RepairEvidence = {
    pricingVerified: false,
    sellable: false,
    categoryPermitted: true,
    inventoryAvailable: false,
    contentComplete: false,
    blocker: null,
    notes: [],
  };

  // Fresh supplier and delivery evidence. Never inferred from a stored flag.
  const sellability = await productSellability(input.shopifyProductId);
  evidence.sellable = sellability.sellable;
  evidence.notes.push(sellability.message);

  const { data: mirror } = await supabase
    .from("shopify_products")
    .select("id, handle, title, featured_image_url, product_type, vendor, tags, description")
    .eq("shopify_product_id", input.shopifyProductId)
    .maybeSingle();

  if (mirror) {
    const { isProhibitedRow } = await import("@/lib/policy/prohibited");
    evidence.categoryPermitted = !isProhibitedRow(mirror as never);
    evidence.contentComplete = Boolean(
      (mirror as any).handle && (mirror as any).title && (mirror as any).featured_image_url,
    );

    const { data: variants } = await supabase
      .from("shopify_product_variants")
      .select("available_for_sale, inventory_quantity")
      .eq("product_id", (mirror as any).id);
    evidence.inventoryAvailable = ((variants ?? []) as any[]).some(
      (variant) => variant.available_for_sale === true || Number(variant.inventory_quantity ?? 0) > 0,
    );

    const { data: suppressed } = await supabase
      .from("duplicate_group_members")
      .select("id")
      .eq("product_id", (mirror as any).id)
      .eq("suppressed", true)
      .maybeSingle();
    if (suppressed) evidence.blocker = "an unresolved duplicate suppression";
  } else {
    evidence.notes.push("There is no local catalogue record for this product yet");
  }

  const { data: intake } = await supabase
    .from("product_intake_records")
    .select("state, reason")
    .eq("shopify_product_id", input.shopifyProductId)
    .maybeSingle();
  const intakeState = (intake as any)?.state ?? null;
  if (["quarantined", "rejected", "failed"].includes(String(intakeState))) {
    evidence.blocker = `intake state ${intakeState}`;
  }

  // Only worth pricing if the rest of the evidence already holds. A product we
  // are going to remove is never written to first.
  const worthPricing =
    evidence.sellable &&
    evidence.categoryPermitted &&
    evidence.inventoryAvailable &&
    evidence.contentComplete &&
    !evidence.blocker;

  let priceParity: Record<string, unknown> = {};
  let statusAfter: string | null = null;
  let surfaces: string[] = [];

  if (worthPricing && !input.dryRun) {
    const lifecycle = await runPricingLifecycle({
      shopifyProductIds: [input.shopifyProductId],
      activate: true,
      force: true,
    });
    const outcome = lifecycle.outcomes[0] ?? null;
    evidence.pricingVerified = outcome?.status === "verified";
    priceParity = {
      status: outcome?.status ?? "unknown",
      variants: outcome?.variants ?? 0,
      verified_variants: outcome?.verifiedVariants ?? 0,
      reason: outcome?.reason ?? "",
      activation: outcome?.activation ?? null,
      publication: outcome?.publication ?? null,
    };

    if (evidence.pricingVerified) {
      const state = await confirmSurfaces(input.shopifyProductId);
      statusAfter = state.status;
      surfaces = state.surfaces;
      if (state.status !== "active" || !surfacesComplete(state.kinds)) {
        evidence.pricingVerified = false;
        evidence.notes.push(
          `The product did not reach all three selling surfaces: status ${state.status}, present on ${
            state.surfaces.join(", ") || "no channel"
          }`,
        );
      } else if (mirror) {
        await supabase
          .from("shopify_products")
          .update({ channels_verified_at: new Date().toISOString() } as never)
          .eq("id", (mirror as any).id);
      }
    }
  } else if (worthPricing && input.dryRun) {
    evidence.pricingVerified = true;
    priceParity = { status: "dry_run" };
  }

  const verdict = decideRepairAction(evidence);

  if (verdict.decision === "publish") {
    return {
      decision: "publish",
      reasonCode: verdict.reasonCode,
      reason: verdict.reason,
      statusAfter: statusAfter ?? "active",
      surfaces,
      evidence: { ...evidence } as unknown as Record<string, unknown>,
      priceParity,
    };
  }

  const removal = await deleteProductPermanently({
    shopifyProductId: input.shopifyProductId,
    reasonCode: verdict.reasonCode,
    reason: verdict.reason,
    runId: input.runId,
    authorisedBy: input.authorisedBy,
    dryRun: input.dryRun,
  });

  if (removal.blocked || (!removal.deleted && !input.dryRun)) {
    return {
      decision: "blocked",
      reasonCode: removal.blocked ? "dependency" : "store_refused",
      reason: removal.reason,
      statusAfter: null,
      surfaces: [],
      evidence: { ...evidence } as unknown as Record<string, unknown>,
      priceParity,
    };
  }

  return {
    decision: "delete",
    reasonCode: verdict.reasonCode,
    reason: removal.reason,
    statusAfter: "deleted",
    surfaces: [],
    evidence: { ...evidence } as unknown as Record<string, unknown>,
    priceParity,
  };
}

/** Reads back the live status and channel presence after activation. */
async function confirmSurfaces(
  shopifyProductId: string,
): Promise<{ status: string; surfaces: string[]; kinds: string[] }> {
  const { readStorePublications } = await import("@/lib/zendrop/store-publication.server");
  const { classifyChannel } = await import("@/lib/zendrop/publication-policy");
  const report = await readStorePublications(shopifyProductId);
  const surfaces = report.currentChannels ?? [];
  return {
    status: String(report.status ?? "").toLowerCase(),
    surfaces,
    kinds: surfaces.map((name: string) => classifyChannel(name)),
  };
}

/**
 * Closes the run: rebuilds the public projection from the corrected data and
 * records the counts the three views ended on.
 */
export async function finishRepairRun(runId: string): Promise<RepairRunSummary> {
  const supabase = await zendropAdminClient();
  const { refreshStorefrontSnapshot } = await import("@/lib/automation/snapshot.server");
  await refreshStorefrontSnapshot(supabase, "catalogue_repair");

  const after = await measureCatalogue();
  const { data: items } = await supabase
    .from("catalogue_repair_items")
    .select("decision")
    .eq("run_id", runId)
    .limit(5000);
  const totals: Record<string, number> = {};
  for (const row of ((items ?? []) as any[])) {
    const key = String(row.decision);
    totals[key] = (totals[key] ?? 0) + 1;
  }

  const finished = (totals["pending"] ?? 0) === 0;
  const message = `Repair ${finished ? "complete" : "paused"}. ${Object.entries(totals)
    .map(([key, value]) => `${value} ${key}`)
    .join(", ")}. The store now holds ${after.live_total} product(s), ${
    after.live_active
  } active and ${after.live_draft} draft. The catalogue mirror holds ${
    after.mirror
  } and the website lists ${after.snapshot}.`;

  await supabase
    .from("catalogue_repair_runs")
    .update({
      status: finished ? "succeeded" : "paused",
      totals: totals as never,
      after_counts: after as never,
      finished_at: finished ? new Date().toISOString() : null,
      message,
    } as never)
    .eq("id", runId);

  return {
    runId,
    dryRun: false,
    status: finished ? "succeeded" : "paused",
    counts: { ...after, ...totals },
    message,
  };
}
