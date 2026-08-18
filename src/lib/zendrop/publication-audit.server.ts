/**
 * Catalogue wide sales channel audit and reconciliation.
 *
 * The audit is read only and is the default. It walks the active catalogue,
 * reads the real channel state of each product from the store, and compares it
 * with the desired state, which is the headless channel only. Nothing is
 * changed unless a caller deliberately asks for a live run.
 *
 * The live run reconciles in small batches, writes an audit row per product,
 * and is idempotent, so a compliant product produces no store write at all.
 * Product status, prices, variants and inventory are never touched.
 */
import { zendropAdminClient } from "./client.server";
import {
  ensureStorePublications,
  loadPublicationPolicy,
  readStoreChannels,
  readStorePublications,
} from "./store-publication.server";
import { resolveHeadlessChannel, type PublicationPolicy } from "./publication-policy";

export interface PublicationAuditItem {
  shopifyProductId: string;
  title: string | null;
  status: string | null;
  currentChannels: string[];
  desiredChannels: string[];
  toPublish: string[];
  toUnpublish: string[];
  drifted: boolean;
  changed: boolean;
  message: string;
}

export interface PublicationAuditRun {
  runId: string | null;
  mode: "dry_run" | "live";
  inspected: number;
  drifted: number;
  changed: number;
  desiredChannels: string[];
  items: PublicationAuditItem[];
  note: string;
}

export interface PublicationAuditOptions {
  /** Live runs must be asked for explicitly. */
  dryRun?: boolean;
  /** How many products to inspect in this pass. */
  limit?: number;
  /** Restrict a live run to one product, used for controlled proving. */
  shopifyProductId?: string;
  /** Recorded on the audit row so a run can be traced back to a person. */
  actorId?: string | null;
  policy?: PublicationPolicy;
}

const MAX_BATCH = 50;

/**
 * Runs the audit. Dry run by default.
 */
export async function runPublicationAudit(
  options: PublicationAuditOptions = {},
): Promise<PublicationAuditRun> {
  const dryRun = options.dryRun !== false;
  const limit = Math.max(1, Math.min(options.limit ?? MAX_BATCH, MAX_BATCH));
  const policy = options.policy ?? (await loadPublicationPolicy());
  const supabase = await zendropAdminClient();

  // Fail closed before anything else if the headless channel is not uniquely
  // identifiable in this store.
  const channels = await readStoreChannels();
  const headless = resolveHeadlessChannel(channels);
  const desiredChannels = [headless.name];

  let query = supabase
    .from("shopify_products")
    .select("shopify_product_id, title, status")
    .order("title", { ascending: true })
    .limit(limit);
  if (options.shopifyProductId) {
    query = query.eq("shopify_product_id", options.shopifyProductId);
  } else {
    query = query.eq("status", "active");
  }
  const { data: products } = await query;
  const rows = (products ?? []) as Array<{
    shopify_product_id: string;
    title: string | null;
    status: string | null;
  }>;

  const { data: runRow } = await (supabase as any)
    .from("publication_audit_runs")
    .insert({
      mode: dryRun ? "dry_run" : "live",
      status: "running",
      desired_channels: desiredChannels,
      created_by: options.actorId ?? null,
    })
    .select("id")
    .maybeSingle();
  const runId: string | null = runRow?.id ?? null;

  const items: PublicationAuditItem[] = [];
  let drifted = 0;
  let changed = 0;

  for (const row of rows) {
    const productId = String(row.shopify_product_id);
    try {
      const report = await readStorePublications(productId, policy);
      let message = report.drifted
        ? "Drifted from the desired channel state"
        : "Already on the desired channels only";
      let didChange = false;

      if (report.drifted) drifted += 1;

      if (!dryRun && report.drifted) {
        const result = await ensureStorePublications(productId, policy, { removeUnwanted: true });
        message = result.message;
        didChange = result.published.length > 0 || result.unpublished.length > 0;
        if (didChange) changed += 1;
      }

      items.push({
        shopifyProductId: productId,
        title: report.title ?? row.title,
        status: report.status ?? row.status,
        currentChannels: report.currentChannels,
        desiredChannels: report.desiredChannels,
        toPublish: report.toPublish,
        toUnpublish: report.toUnpublish,
        drifted: report.drifted,
        changed: didChange,
        message,
      });
    } catch (cause) {
      items.push({
        shopifyProductId: productId,
        title: row.title,
        status: row.status,
        currentChannels: [],
        desiredChannels,
        toPublish: [],
        toUnpublish: [],
        drifted: false,
        changed: false,
        message: cause instanceof Error ? cause.message : "The channel state could not be read",
      });
    }
  }

  if (runId) {
    await (supabase as any).from("publication_audit_items").insert(
      items.map((item) => ({
        run_id: runId,
        shopify_product_id: item.shopifyProductId,
        product_title: item.title,
        product_status: item.status,
        current_channels: item.currentChannels,
        desired_channels: item.desiredChannels,
        to_publish: item.toPublish,
        to_unpublish: item.toUnpublish,
        drifted: item.drifted,
        changed: item.changed,
        message: item.message,
      })),
    );
    await (supabase as any)
      .from("publication_audit_runs")
      .update({
        status: "complete",
        products_inspected: items.length,
        products_drifted: drifted,
        products_changed: changed,
        note: dryRun
          ? "Dry run. Nothing was changed in the store"
          : "Live reconciliation to the headless channel only",
      })
      .eq("id", runId);
  }

  return {
    runId,
    mode: dryRun ? "dry_run" : "live",
    inspected: items.length,
    drifted,
    changed,
    desiredChannels,
    items,
    note: dryRun
      ? "Dry run. Nothing was changed in the store"
      : "Live reconciliation to the headless channel only",
  };
}

export interface ChannelChecklist {
  channels: Array<{ name: string; desired: boolean; note: string }>;
  headlessResolved: boolean;
  problem: string | null;
  onlineStoreOptIn: boolean;
}

/** The desired channel configuration, resolved live from the store. */
export async function readChannelChecklist(): Promise<ChannelChecklist> {
  const policy = await loadPublicationPolicy();
  try {
    const channels = await readStoreChannels();
    const headless = resolveHeadlessChannel(channels);
    return {
      headlessResolved: true,
      problem: null,
      onlineStoreOptIn: policy.includeOnlineStore,
      channels: channels.map((channel) => {
        if (channel.id === headless.id) {
          return {
            name: channel.name,
            desired: true,
            note: "Serves nurgoods.com and issues the checkout link",
          };
        }
        const lower = channel.name.trim().toLowerCase();
        if (lower === "online store") {
          return {
            name: channel.name,
            desired: policy.includeOnlineStore,
            note: policy.includeOnlineStore
              ? "Opt in recorded, so it is still published to"
              : "Off. Headless only checkout is proven",
          };
        }
        if (lower === "shop" || lower === "shop app") {
          return { name: channel.name, desired: false, note: "Blocked in code. Never published to" };
        }
        if (lower.includes("point of sale")) {
          return { name: channel.name, desired: false, note: "Off. No physical retail" };
        }
        return { name: channel.name, desired: false, note: "Not part of the selling path" };
      }),
    };
  } catch (cause) {
    return {
      channels: [],
      headlessResolved: false,
      onlineStoreOptIn: policy.includeOnlineStore,
      problem: cause instanceof Error ? cause.message : "The store channels could not be read",
    };
  }
}
