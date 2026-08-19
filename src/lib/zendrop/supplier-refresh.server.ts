/**
 * Supplier product reconciliation for listings that are already on sale.
 *
 * Discovery brings new products in. This module keeps the ones already live
 * honest: it re-reads the supplier record, re-quotes destination shipping for
 * every supported market, recalculates the price from the refreshed landed
 * cost and takes a listing off sale when the supplier can no longer evidence
 * that it is deliverable, in stock, or profitable.
 *
 * Every supplier call here is read only. Nothing in this module creates,
 * confirms, pays for or modifies a supplier order.
 */
import { zendropAdminClient } from "./client.server";
import { getZendropProduct, quoteZendropShipping } from "./catalogue.server";
import { loadPricingSettings, loadSourcingRules } from "./import.server";
import { getFxRate, convertAmount } from "./fx.server";
import { resolveSupportedMarkets } from "../pricing/markets";

/** How long a supplier fact may go unrefreshed before the listing is held. */
const STALE_HOURS = 72;
/** Consecutive read failures tolerated before a listing is pulled from sale. */
const FAILURE_TOLERANCE = 3;

export type SupplierSyncState =
  | "healthy"
  | "repriced"
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
}

export interface SupplierRefreshResult {
  inspected: number;
  healthy: number;
  repriced: number;
  held: number;
  errored: number;
  items: SupplierRefreshItem[];
  message: string;
}

interface LinkRow {
  id: string;
  product_id: string | null;
  shopify_product_id: string | null;
  supplier_product_id: string | null;
  last_supplier_sync_at: string | null;
  consecutive_sync_failures: number | null;
}

function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  return (Date.now() - parsed) / 3_600_000;
}

/**
 * Refreshes a bounded batch of supplier backed listings, oldest sync first, so
 * the whole catalogue is covered on a rolling basis without ever bursting the
 * supplier with concurrent reads.
 */
export async function runSupplierProductRefresh(options?: {
  batchSize?: number;
  /** Restrict to one link, used for controlled proving. */
  supplierProductId?: string;
  /** Read only: report what would change without writing to the store. */
  dryRun?: boolean;
}): Promise<SupplierRefreshResult> {
  const dryRun = options?.dryRun === true;
  const batchSize = Math.max(1, Math.min(options?.batchSize ?? 25, 100));
  const supabase = await zendropAdminClient();
  const settings = await loadPricingSettings();
  const rules = await loadSourcingRules();
  const supported = resolveSupportedMarkets(settings.supported_markets);

  let query = supabase
    .from("product_supplier_links")
    .select(
      "id, product_id, shopify_product_id, supplier_product_id, last_supplier_sync_at, consecutive_sync_failures",
    )
    .not("supplier_product_id", "is", null)
    .order("last_supplier_sync_at", { ascending: true, nullsFirst: true })
    .limit(batchSize);
  if (options?.supplierProductId) {
    query = query.eq("supplier_product_id", options.supplierProductId);
  }
  const { data } = await query;
  const links = ((data ?? []) as unknown as LinkRow[]).filter((row) => row.supplier_product_id);

  const items: SupplierRefreshItem[] = [];
  let healthy = 0;
  let repriced = 0;
  let held = 0;
  let errored = 0;

  for (const link of links) {
    const supplierProductId = String(link.supplier_product_id);
    const failures = Number(link.consecutive_sync_failures ?? 0);
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
    };

    let supplierProduct: Awaited<ReturnType<typeof getZendropProduct>> = null;
    let readFailed = false;
    try {
      supplierProduct = await getZendropProduct(supplierProductId, settings.shipping_market);
    } catch {
      readFailed = true;
    }

    if (readFailed || !supplierProduct) {
      const nextFailures = failures + 1;
      const age = hoursSince(link.last_supplier_sync_at);
      const stale = age === null || age > STALE_HOURS;
      if (nextFailures >= FAILURE_TOLERANCE && stale) {
        item.state = "held_stale";
        item.reason = `The supplier record could not be read ${nextFailures} times running and the last confirmed reading is older than ${STALE_HOURS} hours, so the listing was taken off sale rather than sold on stale facts.`;
        item.heldFromSale = await takeOffSale(link.shopify_product_id, dryRun);
        held += 1;
      } else {
        item.state = "error";
        item.reason = "The supplier record could not be read on this pass. It will be retried.";
        errored += 1;
      }
      await writeHealth(supabase, link.id, item, nextFailures, dryRun);
      items.push(item);
      continue;
    }

    item.inventory = supplierProduct.inventory;

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

    // Availability first. Backorders stay off, so no stock means no sale.
    const outOfStock =
      rules.require_stock && supplierProduct.inventory !== null && supplierProduct.inventory <= 0;
    if (outOfStock) {
      item.state = "held_unavailable";
      item.reason = "The supplier reports no available stock, so the listing was taken off sale.";
      item.heldFromSale = await takeOffSale(link.shopify_product_id, dryRun);
      held += 1;
      await writeHealth(supabase, link.id, item, 0, dryRun);
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
      await writeHealth(supabase, link.id, item, 0, dryRun);
      items.push(item);
      continue;
    }

    // Price safety. The refreshed supplier cost is converted with a live rate
    // and the store price is recalculated from it. A price that cannot clear
    // the margin floor holds the listing rather than selling at a loss.
    try {
      const fx = await getFxRate(supplierProduct.currency, settings.currency);
      const supplierCost = convertAmount(supplierProduct.cost, fx.rate);
      const shipping = convertAmount(worstShipping, fx.rate);
      item.landedCost =
        supplierCost === null ? null : Number((supplierCost + (shipping ?? 0)).toFixed(2));

      if (link.shopify_product_id) {
        const { applyCalculatedPriceToStore } = await import("./store-pricing.server");
        const pricing = dryRun
          ? { applied: false, updated: 0, variants: [], message: "Dry run" }
          : await applyCalculatedPriceToStore({
              shopifyProductId: link.shopify_product_id,
              shippingCost: shipping,
              settings,
            });
        item.repricedVariants = pricing.updated;
        if (pricing.updated > 0) {
          item.state = "repriced";
          item.reason = `Supplier cost moved, so ${pricing.updated} variant price(s) were recalculated from the refreshed landed cost.`;
          repriced += 1;
        } else {
          item.state = "healthy";
          item.reason = `Supplier facts confirmed. Deliverable to ${eligibleMarkets.join(", ")}.`;
          healthy += 1;
        }
      } else {
        item.state = "healthy";
        item.reason = "Supplier facts confirmed. The listing is not linked to a store product yet.";
        healthy += 1;
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

    await writeHealth(supabase, link.id, item, 0, dryRun);
    items.push(item);
  }

  return {
    inspected: items.length,
    healthy,
    repriced,
    held,
    errored,
    items,
    message:
      items.length === 0
        ? "There are no supplier backed listings to reconcile yet."
        : `Reconciled ${items.length} supplier backed listing(s): ${healthy} confirmed, ${repriced} repriced, ${held} taken off sale, ${errored} left for retry.${dryRun ? " Dry run, nothing was changed." : ""}`,
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
  linkId: string,
  item: SupplierRefreshItem,
  failures: number,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) return;
  await supabase
    .from("product_supplier_links")
    .update({
      supplier_status: item.state,
      supplier_available: item.inventory === null ? null : item.inventory > 0,
      supplier_inventory: item.inventory,
      last_supplier_sync_at: item.state === "error" ? undefined : new Date().toISOString(),
      sync_state: item.state,
      sync_reason: item.reason,
      consecutive_sync_failures: failures,
    } as never)
    .eq("id", linkId);
}

/** Read only health snapshot for the admin console. */
export async function supplierSyncSnapshot(): Promise<{
  total: number;
  byState: Record<string, number>;
  stale: number;
  recent: Array<{
    supplierProductId: string;
    shopifyProductId: string | null;
    state: string;
    reason: string | null;
    inventory: number | null;
    syncedAt: string | null;
  }>;
}> {
  const supabase = await zendropAdminClient();
  const { data } = await supabase
    .from("product_supplier_links")
    .select(
      "supplier_product_id, shopify_product_id, sync_state, sync_reason, supplier_inventory, last_supplier_sync_at",
    )
    .order("last_supplier_sync_at", { ascending: false, nullsFirst: false })
    .limit(500);
  const rows = (data ?? []) as any[];
  const byState: Record<string, number> = {};
  let stale = 0;
  for (const row of rows) {
    const state = String(row.sync_state ?? "pending");
    byState[state] = (byState[state] ?? 0) + 1;
    const age = hoursSince(row.last_supplier_sync_at ?? null);
    if (age === null || age > STALE_HOURS) stale += 1;
  }
  return {
    total: rows.length,
    byState,
    stale,
    recent: rows.slice(0, 25).map((row) => ({
      supplierProductId: String(row.supplier_product_id ?? ""),
      shopifyProductId: row.shopify_product_id ?? null,
      state: String(row.sync_state ?? "pending"),
      reason: row.sync_reason ?? null,
      inventory: row.supplier_inventory ?? null,
      syncedAt: row.last_supplier_sync_at ?? null,
    })),
  };
}
