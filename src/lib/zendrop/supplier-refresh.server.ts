/**
 * Supplier product reconciliation for listings that are already on sale.
 *
 * Discovery brings new products in. This module keeps the ones already live
 * honest: it re-reads the supplier record, re-quotes destination shipping for
 * every supported market, recalculates the price from the refreshed landed
 * cost, and takes a listing off sale when the supplier can no longer evidence
 * that it is deliverable, in stock, or profitable. It also brings a held
 * listing back on sale on its own once every one of those things clears again.
 *
 * Three properties make this safe at catalogue scale:
 *
 *   - Work is claimed under a database lease, so two runs can never reconcile
 *     the same listing at once and a crashed run releases its work on expiry.
 *   - The batch size is derived from the current catalogue size and the
 *     freshness target, inside a configured ceiling, so a growing catalogue
 *     does not silently fall outside its own freshness window.
 *   - Freshness is enforced independently of the read succeeding. A listing
 *     whose supplier facts age past the target comes off sale even if every
 *     attempt to refresh it failed, so an outage can never keep stale stock on
 *     sale.
 *
 * Every supplier call here is read only. Nothing in this module creates,
 * confirms, pays for or modifies a supplier order.
 */
import { zendropAdminClient } from "./client.server";
import { getZendropProduct, quoteZendropShipping } from "./catalogue.server";
import { loadPricingSettings, loadSourcingRules } from "./import.server";
import { getFxRate, convertAmount } from "./fx.server";
import { resolveSupportedMarkets } from "../pricing/markets";
import {
  normaliseTuning,
  planRefreshBatch,
  projectSweepTiers,
  retryDelayMinutes,
  type RefreshPlan,
  type RefreshTuning,
} from "./refresh-plan";
import { readSupplierStock, saleabilityFromStock } from "./variant-stock";

/** Consecutive read failures tolerated before a listing is pulled from sale. */
const FAILURE_TOLERANCE = 3;
/** Price movement below this is rounding noise and is never written back. */
const PRICE_NOISE_TOLERANCE = 0.01;
/** How long a claimed listing stays leased to one run. */
const LEASE_SECONDS = 600;

export type SupplierSyncState =
  | "healthy"
  | "repriced"
  | "recovered"
  | "held_unavailable"
  | "held_undeliverable"
  | "held_unprofitable"
  | "held_stale"
  | "error";

export interface SupplierRefreshItem {
  productId: string | null;
  shopifyProductId: string | null;
  supplierProductId: string;
  state: SupplierSyncState;
  reason: string;
  inventory: number | null;
  landedCost: number | null;
  repricedVariants: number;
  heldFromSale: boolean;
  restoredToSale: boolean;
  blockedVariants: string[];
}

export interface SupplierRefreshResult {
  inspected: number;
  healthy: number;
  repriced: number;
  recovered: number;
  held: number;
  errored: number;
  staleSwept: number;
  plan: RefreshPlan;
  items: SupplierRefreshItem[];
  message: string;
}

interface LinkRow {
  id: string;
  product_id: string | null;
  shopify_product_id: string | null;
  supplier_product_id: string | null;
  supplier_import_list_id: string | null;
  last_supplier_sync_at: string | null;
  consecutive_sync_failures: number | null;
  retry_count: number | null;
  manual_hold: boolean | null;
  sync_state: string | null;
  landed_cost: number | null;
  variant_map: unknown;
}

function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  return (Date.now() - parsed) / 3_600_000;
}

function tuningFrom(rules: {
  freshness_target_hours: number;
  refresh_min_batch: number;
  refresh_max_batch: number;
  refresh_headroom_pct: number;
  refresh_runs_per_hour: number;
}): RefreshTuning {
  return normaliseTuning({
    freshnessTargetHours: rules.freshness_target_hours,
    minBatch: rules.refresh_min_batch,
    maxBatch: rules.refresh_max_batch,
    headroomPct: rules.refresh_headroom_pct,
    runsPerHour: rules.refresh_runs_per_hour,
  });
}

/**
 * Holds every listing whose supplier facts have aged past the freshness
 * target, regardless of why the refresh did not happen.
 *
 * This is the backstop that makes the whole model safe: no infrastructure
 * failure, rate limit or supplier outage can leave a listing on sale against
 * facts we can no longer stand behind.
 */
async function sweepStaleListings(
  supabase: any,
  tuning: RefreshTuning,
  dryRun: boolean,
): Promise<number> {
  const cutoff = new Date(Date.now() - tuning.freshnessTargetHours * 3_600_000).toISOString();
  const { data } = await supabase
    .from("product_supplier_links")
    .select("id, shopify_product_id, sync_state, last_supplier_sync_at")
    .not("supplier_product_id", "is", null)
    .not("shopify_product_id", "is", null)
    .lt("last_supplier_sync_at", cutoff)
    .in("sync_state", ["healthy", "repriced", "recovered"])
    .limit(200);

  const rows = (data ?? []) as Array<{ id: string; shopify_product_id: string }>;
  let held = 0;
  for (const row of rows) {
    const wasHeld = await takeOffSale(row.shopify_product_id, dryRun);
    if (!dryRun) {
      await supabase
        .from("product_supplier_links")
        .update({
          sync_state: "held_stale",
          supplier_status: "held_stale",
          sync_reason: `The supplier facts for this listing aged past the ${tuning.freshnessTargetHours} hour freshness target before they could be refreshed, so it was taken off sale rather than sold on stale facts.`,
          held_at: new Date().toISOString(),
          held_reason: "freshness_target_breached",
        } as never)
        .eq("id", row.id);
    }
    if (wasHeld || dryRun) held += 1;
  }
  return rows.length === 0 ? 0 : held;
}

/**
 * Refreshes an adaptively sized batch of supplier backed listings, oldest sync
 * first, under a database lease so the whole catalogue is covered on a rolling
 * basis without ever bursting the supplier with concurrent reads.
 */
export async function runSupplierProductRefresh(options?: {
  batchSize?: number;
  /** Restrict to one link, used for controlled proving. */
  supplierProductId?: string;
  /** Read only: report what would change without writing to the store. */
  dryRun?: boolean;
}): Promise<SupplierRefreshResult> {
  const dryRun = options?.dryRun === true;
  const supabase = await zendropAdminClient();
  const settings = await loadPricingSettings();
  const rules = await loadSourcingRules();
  const supported = resolveSupportedMarkets(settings.supported_markets);
  const tuning = tuningFrom(rules);

  const { count } = await supabase
    .from("product_supplier_links")
    .select("id", { count: "exact", head: true })
    .not("supplier_product_id", "is", null);
  const plan = planRefreshBatch(Number(count ?? 0), tuning);

  const staleSwept = dryRun ? 0 : await sweepStaleListings(supabase, tuning, dryRun);

  const batchSize = Math.max(
    1,
    Math.min(options?.batchSize ?? plan.batchSize, tuning.maxBatch, 200),
  );

  let links: LinkRow[] = [];
  const owner = `refresh:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

  if (options?.supplierProductId) {
    const { data } = await supabase
      .from("product_supplier_links")
      .select("*")
      .eq("supplier_product_id", options.supplierProductId)
      .limit(1);
    links = (data ?? []) as unknown as LinkRow[];
  } else if (dryRun) {
    const { data } = await supabase
      .from("product_supplier_links")
      .select("*")
      .not("supplier_product_id", "is", null)
      .order("last_supplier_sync_at", { ascending: true, nullsFirst: true })
      .limit(batchSize);
    links = (data ?? []) as unknown as LinkRow[];
  } else {
    // Atomic claim. A second concurrent run gets a disjoint set or nothing.
    const { data, error } = await supabase.rpc("claim_supplier_links", {
      _owner: owner,
      _batch: batchSize,
      _lease_seconds: LEASE_SECONDS,
    });
    if (error) throw new Error(`Supplier links could not be claimed: ${error.message}`);
    links = (data ?? []) as unknown as LinkRow[];
  }

  links = links.filter((row) => row.supplier_product_id);

  const items: SupplierRefreshItem[] = [];
  let healthy = 0;
  let repriced = 0;
  let recovered = 0;
  let held = 0;
  let errored = 0;

  for (const link of links) {
    const supplierProductId = String(link.supplier_product_id);
    const failures = Number(link.consecutive_sync_failures ?? 0);
    const wasHeld = String(link.sync_state ?? "").startsWith("held");
    const manualHold = link.manual_hold === true;
    const item: SupplierRefreshItem = {
      productId: link.product_id,
      shopifyProductId: link.shopify_product_id,
      supplierProductId,
      state: "healthy",
      reason: "",
      inventory: null,
      landedCost: null,
      repricedVariants: 0,
      heldFromSale: false,
      restoredToSale: false,
      blockedVariants: [],
    };

    let supplierProduct: Awaited<ReturnType<typeof getZendropProduct>> = null;
    let readError: string | null = null;
    try {
      supplierProduct = await getZendropProduct(supplierProductId, settings.shipping_market);
    } catch (cause) {
      readError = cause instanceof Error ? cause.message : "The supplier read failed";
    }

    if (readError || !supplierProduct) {
      const nextFailures = failures + 1;
      const age = hoursSince(link.last_supplier_sync_at);
      const stale = age === null || age > tuning.freshnessTargetHours;
      if (nextFailures >= FAILURE_TOLERANCE && stale) {
        item.state = "held_stale";
        item.reason = `The supplier record could not be read ${nextFailures} times running and the last confirmed reading is older than ${tuning.freshnessTargetHours} hours, so the listing was taken off sale rather than sold on stale facts.`;
        item.heldFromSale = await takeOffSale(link.shopify_product_id, dryRun);
        held += 1;
      } else {
        item.state = "error";
        item.reason = `The supplier record could not be read on this pass. It will be retried with backoff.${
          readError ? ` ${readError}` : ""
        }`;
        errored += 1;
      }
      await writeHealth(supabase, link, item, {
        failures: nextFailures,
        retryCount: Number(link.retry_count ?? 0) + 1,
        lastError: readError,
        dryRun,
      });
      items.push(item);
      continue;
    }

    // What the supplier will actually tell us about stock. On the connected
    // plan this is nothing at all, so this never fabricates a quantity.
    const stock = readSupplierStock({
      catalogueProduct: { inventory: supplierProduct.inventory },
      catalogueVariants: supplierProduct.variants as unknown as Array<Record<string, unknown>>,
      storeVariants: Array.isArray(link.variant_map)
        ? (link.variant_map as Array<Record<string, unknown>>)
        : [],
    });
    const saleability = saleabilityFromStock(stock, { requireStock: rules.require_stock });
    item.inventory = supplierProduct.inventory;
    item.blockedVariants = saleability.blockedVariantSkus;

    // Fresh, destination specific shipping evidence for every supported
    // market. A listing only stays sellable while at least one supported
    // market can be quoted.
    let eligibleMarkets: string[] = [];
    let worstShipping: number | null = null;
    let eligibilityReason = "";
    try {
      const { quoteAndRecordMarkets, loadMarketEvidence } = await import(
        "../pricing/market-eligibility.server"
      );
      const eligibility = await quoteAndRecordMarkets({
        supplierProductId,
        shopifyProductId: link.shopify_product_id ?? null,
        supported,
        maxAgeDays: settings.shipping_quote_max_age_days,
        supplierCurrency: supplierProduct.currency,
        quote: async (productId, market) => {
          const quote = await quoteZendropShipping(productId, market);
          return { cost: quote.cost, service: quote.service };
        },
      });
      eligibleMarkets = eligibility.eligibleMarkets;
      eligibilityReason = eligibility.qualifies ? "" : (eligibility.reason ?? "");
      const evidence = await loadMarketEvidence(supplierProductId);
      for (const row of evidence) {
        if (!eligibleMarkets.includes(row.market)) continue;
        const amount = row.amount;
        if (amount === null || amount === undefined) continue;
        if (worstShipping === null || amount > worstShipping) worstShipping = amount;
      }
    } catch (cause) {
      eligibilityReason =
        cause instanceof Error
          ? `Destination shipping could not be re-evidenced: ${cause.message}`
          : "Destination shipping could not be re-evidenced";
    }

    // Availability first. Backorders stay off, so no evidenced stock means no
    // sale. Where the supplier gives no stock signal this never fires, and the
    // store side oversell policy carries the protection instead.
    if (!saleability.sellable) {
      item.state = "held_unavailable";
      item.reason = saleability.reason;
      item.heldFromSale = await takeOffSale(link.shopify_product_id, dryRun);
      held += 1;
      await writeHealth(supabase, link, item, { failures: 0, retryCount: 0, dryRun });
      items.push(item);
      continue;
    }

    if (eligibleMarkets.length === 0) {
      item.state = "held_undeliverable";
      item.reason =
        eligibilityReason ||
        "No supported market has fresh supplier shipping evidence, so the listing was taken off sale.";
      item.heldFromSale = await takeOffSale(link.shopify_product_id, dryRun);
      held += 1;
      await writeHealth(supabase, link, item, { failures: 0, retryCount: 0, dryRun });
      items.push(item);
      continue;
    }

    // Price safety. The refreshed supplier cost is converted with a live rate
    // and the store price is recalculated from it. A price that cannot clear
    // the margin floor holds the listing rather than selling at a loss.
    let supplierCostConverted: number | null = null;
    try {
      const fx = await getFxRate(supplierProduct.currency, settings.currency);
      supplierCostConverted = convertAmount(supplierProduct.cost, fx.rate);
      const shipping = convertAmount(worstShipping, fx.rate);
      item.landedCost =
        supplierCostConverted === null
          ? null
          : Number((supplierCostConverted + (shipping ?? 0)).toFixed(2));

      if (item.landedCost === null) {
        throw new Error("The supplier cost could not be converted into the selling currency");
      }

      // Idempotence: a landed cost that has not materially moved never
      // triggers a store write, so prices cannot thrash on rounding noise.
      const previous = link.landed_cost === null ? null : Number(link.landed_cost);
      const materiallyMoved =
        previous === null || Math.abs(item.landedCost - previous) > PRICE_NOISE_TOLERANCE;

      if (link.shopify_product_id && materiallyMoved) {
        const { applyCalculatedPriceToStore } = await import("./store-pricing.server");
        const pricing = dryRun
          ? { applied: false, updated: 0, variants: [], message: "Dry run" }
          : await applyCalculatedPriceToStore({
              shopifyProductId: link.shopify_product_id,
              shippingCost: shipping,
              settings,
            });
        item.repricedVariants = pricing.updated;
      }

      // Oversell protection. The supplier evidences no quantity, so the store
      // itself must refuse to sell beyond what it is tracking.
      if (link.shopify_product_id && !dryRun && !rules.inventory_policy_override) {
        try {
          const { enforceNoOversell } = await import("./inventory-policy.server");
          await enforceNoOversell({ shopifyProductId: link.shopify_product_id });
        } catch {
          // Policy drift is corrected on the next pass rather than failing the
          // whole reconciliation of an otherwise healthy listing.
        }
      }

      if (item.repricedVariants > 0) {
        item.state = "repriced";
        item.reason = `Supplier cost moved, so ${item.repricedVariants} variant price(s) were recalculated from the refreshed landed cost.`;
        repriced += 1;
      } else if (!link.shopify_product_id) {
        item.state = "healthy";
        item.reason = "Supplier facts confirmed. The listing is not linked to a store product yet.";
        healthy += 1;
      } else {
        item.state = "healthy";
        item.reason = `Supplier facts confirmed. Deliverable to ${eligibleMarkets.join(", ")}. ${stock.note}`;
        healthy += 1;
      }

      // Self healing. Everything above has just been evidenced, so a listing
      // that was held can come back on sale, headless channel only.
      if (wasHeld && rules.auto_recovery_enabled && link.shopify_product_id && !manualHold) {
        const { restoreProductToSale } = await import("./recovery.server");
        const restoration = await restoreProductToSale({
          shopifyProductId: link.shopify_product_id,
          manualHold,
          dryRun,
        });
        if (restoration.restored) {
          item.restoredToSale = true;
          item.state = "recovered";
          item.reason = restoration.reason;
          recovered += 1;
          if (item.state === "recovered" && healthy > 0) healthy -= 1;
        }
      }
    } catch (cause) {
      item.state = "held_unprofitable";
      item.reason =
        cause instanceof Error
          ? `The price could not be re-evidenced, so the listing was taken off sale: ${cause.message}`
          : "The price could not be re-evidenced, so the listing was taken off sale.";
      item.heldFromSale = await takeOffSale(link.shopify_product_id, dryRun);
      held += 1;
    }

    await writeHealth(supabase, link, item, {
      failures: 0,
      retryCount: 0,
      supplierCost: supplierCostConverted,
      supplierCurrency: settings.currency,
      dryRun,
    });
    items.push(item);
  }

  // Supplier refreshes can move title, description or variant wording. The
  // planner compares fingerprints, so a price or stock only change books no
  // model run and this stays cheap at catalogue scale.
  if (!dryRun && items.length > 0) {
    const refreshedProductIds = [
      ...new Set(items.map((item) => item.productId).filter((id): id is string => Boolean(id))),
    ];
    if (refreshedProductIds.length > 0) {
      const { planWork } = await import("@/lib/intelligence/queue.server");
      await planWork(supabase as never, refreshedProductIds, "Supplier record refreshed");
    }
  }


  return {
    inspected: items.length,
    healthy,
    repriced,
    recovered,
    held,
    errored,
    staleSwept,
    plan,
    items,
    message:
      items.length === 0 && staleSwept === 0
        ? "There are no supplier backed listings due for reconciliation right now."
        : `Reconciled ${items.length} supplier backed listing(s) at a batch size of ${batchSize}: ${healthy} confirmed, ${repriced} repriced, ${recovered} brought back on sale, ${held} taken off sale, ${errored} left for retry, ${staleSwept} held for breaching the freshness target.${
            dryRun ? " Dry run, nothing was changed." : ""
          }`,
  };
}

/** Unpublishes and drafts a store product. Returns whether it was held. */
async function takeOffSale(shopifyProductId: string | null, dryRun: boolean): Promise<boolean> {
  if (!shopifyProductId || dryRun) return false;
  try {
    const { holdProductFromSale } = await import("../pricing/integrity.server");
    await holdProductFromSale(shopifyProductId);
    return true;
  } catch {
    return false;
  }
}

async function writeHealth(
  supabase: any,
  link: LinkRow,
  item: SupplierRefreshItem,
  options: {
    failures: number;
    retryCount: number;
    lastError?: string | null;
    supplierCost?: number | null;
    supplierCurrency?: string | null;
    dryRun: boolean;
  },
): Promise<void> {
  if (options.dryRun) return;
  const now = new Date().toISOString();
  const holding = item.state.startsWith("held");
  const patch: Record<string, unknown> = {
    supplier_status: item.state,
    supplier_available: item.inventory === null ? null : item.inventory > 0,
    supplier_inventory: item.inventory,
    sync_state: item.state,
    sync_reason: item.reason,
    consecutive_sync_failures: options.failures,
    retry_count: options.retryCount,
    last_error: options.lastError ?? null,
    // The lease is always released, successful or not, so a failed listing
    // becomes claimable again as soon as its backoff expires.
    lease_owner: null,
    lease_expires_at: null,
    next_retry_at:
      options.retryCount > 0
        ? new Date(Date.now() + retryDelayMinutes(options.retryCount) * 60_000).toISOString()
        : null,
  };

  // A failed read must not refresh the freshness clock, or a permanently
  // broken listing would never age out.
  if (item.state !== "error") patch["last_supplier_sync_at"] = now;
  if (item.landedCost !== null) patch["landed_cost"] = item.landedCost;
  if (options.supplierCost !== undefined && options.supplierCost !== null) {
    patch["supplier_cost"] = options.supplierCost;
    patch["supplier_cost_currency"] = options.supplierCurrency ?? null;
  }
  if (item.blockedVariants.length > 0) {
    patch["variant_stock"] = { blocked_skus: item.blockedVariants, read_at: now };
  }
  if (holding) {
    patch["held_at"] = now;
    patch["held_reason"] = item.state;
  }
  if (item.restoredToSale) {
    patch["recovered_at"] = now;
    patch["held_at"] = null;
    patch["held_reason"] = null;
  }

  await supabase.from("product_supplier_links").update(patch as never).eq("id", link.id);
}

export interface SupplierHealthSnapshot {
  total: number;
  byState: Record<string, number>;
  stale: number;
  neverSynced: number;
  variantMapped: number;
  variantUnmapped: number;
  manualHolds: number;
  leased: number;
  retrying: number;
  oldestFactHours: number | null;
  freshnessTargetHours: number;
  batchSize: number;
  perHour: number;
  sweepHours: number;
  slaAtRisk: boolean;
  slaNote: string;
  projections: Array<{
    catalogueSize: number;
    batchSize: number;
    perHour: number;
    sweepHours: number;
    withinSla: boolean;
  }>;
  discovery: { page: number; cycle: number; lastAt: string | null; exhaustedAt: string | null };
  recent: Array<{
    supplierProductId: string;
    shopifyProductId: string | null;
    state: string;
    reason: string | null;
    inventory: number | null;
    syncedAt: string | null;
  }>;
}

/**
 * Read only health snapshot for the admin console.
 *
 * The aggregate counts come from the database across the entire supplier
 * backed catalogue, not from a page of rows, so they stay exact at any
 * catalogue size. Only the recent detail list is limited.
 */
export async function supplierSyncSnapshot(): Promise<SupplierHealthSnapshot> {
  const supabase = await zendropAdminClient();
  const rules = await loadSourcingRules();
  const tuning = tuningFrom(rules);

  const { data: healthData } = await supabase.rpc("supplier_sync_health", {
    _stale_hours: tuning.freshnessTargetHours,
  });
  const health = (healthData ?? {}) as Record<string, any>;
  const total = Number(health["total"] ?? 0);
  const plan = planRefreshBatch(total, tuning);
  const oldest = Number(health["oldest_fact_hours"] ?? -1);

  const { data } = await supabase
    .from("product_supplier_links")
    .select(
      "supplier_product_id, shopify_product_id, sync_state, sync_reason, supplier_inventory, last_supplier_sync_at",
    )
    .order("last_supplier_sync_at", { ascending: false, nullsFirst: false })
    .limit(25);

  return {
    total,
    byState: (health["by_state"] ?? {}) as Record<string, number>,
    stale: Number(health["stale"] ?? 0),
    neverSynced: Number(health["never_synced"] ?? 0),
    variantMapped: Number(health["variant_mapped"] ?? 0),
    variantUnmapped: Number(health["variant_unmapped"] ?? 0),
    manualHolds: Number(health["manual_holds"] ?? 0),
    leased: Number(health["leased"] ?? 0),
    retrying: Number(health["retrying"] ?? 0),
    oldestFactHours: oldest < 0 ? null : oldest,
    freshnessTargetHours: tuning.freshnessTargetHours,
    batchSize: plan.batchSize,
    perHour: plan.effectivePerHour,
    sweepHours: Number(plan.sweepHours.toFixed(1)),
    slaAtRisk: !plan.withinSla || Number(health["stale"] ?? 0) > 0,
    slaNote: plan.note,
    projections: projectSweepTiers([161, 1_000, 10_000, 50_000], tuning),
    discovery: {
      page: rules.scan_page,
      cycle: rules.scan_cycle,
      lastAt: rules.scan_last_at,
      exhaustedAt: rules.scan_exhausted_at,
    },
    recent: ((data ?? []) as any[]).map((row) => ({
      supplierProductId: String(row.supplier_product_id ?? ""),
      shopifyProductId: row.shopify_product_id ?? null,
      state: String(row.sync_state ?? "pending"),
      reason: row.sync_reason ?? null,
      inventory: row.supplier_inventory ?? null,
      syncedAt: row.last_supplier_sync_at ?? null,
    })),
  };
}
