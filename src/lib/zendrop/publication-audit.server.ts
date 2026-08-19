/**
 * Catalogue wide sales channel audit and reconciliation.
 *
 * The audit is read only and is the default. It walks the active catalogue,
 * reads the real channel state of each product from the store, and compares it
 * with the approved state: the NUR GOODS headless channel and Shop on, the
 * Online Store, Point of Sale and anything unapproved off. Nothing is changed
 * unless a caller deliberately asks for a live run.
 *
 * Shop can refuse an individual product on its own eligibility rules. That is
 * recorded as an exception against the product, the headless channel is left
 * untouched, and the exception is counted separately from accidental drift.
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
import {
  resolveHeadlessChannel,
  resolveRequiredChannels,
  type PublicationPolicy,
} from "./publication-policy";

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
  /** Approved channels still missing after this pass, exceptions apart. */
  missingRequired: string[];
  /** Unapproved channels found on the product. */
  disallowedPresent: string[];
  /** The store's reason for refusing Shop, when it did. Not drift. */
  shopIneligible: string | null;
  /** True when both approved channels are on and nothing unapproved is. */
  compliant: boolean;
  message: string;
}

export interface PublicationAuditRun {
  runId: string | null;
  /** Offset this pass started at, and where a following pass should resume. */
  offset: number;
  nextOffset: number | null;
  totalMatched: number | null;
  mode: "dry_run" | "live";
  inspected: number;
  drifted: number;
  changed: number;
  /** Products already on Shop before this pass. */
  shopAlready: number;
  /** Products newly published to Shop by this pass. */
  shopPublished: number;
  /** Products Shop itself refused, left on the headless channel. */
  shopIneligible: number;
  /** Products fully compliant at the end of this pass. */
  compliant: number;
  desiredChannels: string[];
  items: PublicationAuditItem[];
  note: string;
}

export interface PublicationAuditOptions {
  /** Live runs must be asked for explicitly. */
  dryRun?: boolean | undefined;
  /** How many products to inspect in this pass. */
  limit?: number | undefined;
  /** Restrict a live run to one product, used for controlled proving. */
  shopifyProductId?: string | undefined;
  /** Restrict a run to an explicit batch of products, used by the migration. */
  shopifyProductIds?: string[] | undefined;
  /** Where to resume from when walking a catalogue larger than one batch. */
  offset?: number | undefined;

  /** Recorded on the audit row so a run can be traced back to a person. */
  actorId?: string | null | undefined;
  policy?: PublicationPolicy | undefined;
}

/** A read only pass may look at more products because it changes nothing. */
const MAX_BATCH = 50;
/**
 * A live pass writes to the store, so it is capped hard here rather than in
 * the admin screen. A caller cannot widen it by sending a larger limit.
 */
const MAX_LIVE_BATCH = 10;

/**
 * Runs the audit. Dry run by default.
 */
export async function runPublicationAudit(
  options: PublicationAuditOptions = {},
): Promise<PublicationAuditRun> {
  const dryRun = options.dryRun !== false;
  const ceiling = dryRun ? MAX_BATCH : MAX_LIVE_BATCH;
  const limit = Math.max(1, Math.min(options.limit ?? ceiling, ceiling));
  const policy = options.policy ?? (await loadPublicationPolicy());
  const supabase = await zendropAdminClient();

  // Fail closed before anything else if the headless channel is not uniquely
  // identifiable in this store.
  const channels = await readStoreChannels();
  resolveHeadlessChannel(channels);
  const required = resolveRequiredChannels(channels, policy);
  const desiredChannels = required.map((channel) => channel.name);

  const offset = Math.max(0, options.offset ?? 0);
  let query = supabase
    .from("shopify_products")
    .select("shopify_product_id, title, status", { count: "exact" })
    // Ordering by a stable unique key rather than title keeps paging correct
    // when two products share a title.
    .order("shopify_product_id", { ascending: true })
    .range(offset, offset + limit - 1);
  if (options.shopifyProductId) {
    query = query.eq("shopify_product_id", options.shopifyProductId);
  } else if (options.shopifyProductIds && options.shopifyProductIds.length > 0) {
    query = query.in("shopify_product_id", options.shopifyProductIds.slice(0, ceiling));
  } else {
    query = query.eq("status", "active");
  }

  const { data: products, count: matchedCount } = await query;
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
  let shopAlready = 0;
  let shopPublished = 0;
  let shopIneligibleCount = 0;
  let compliantCount = 0;
  const isShopName = (name: string) => {
    const value = name.trim().toLowerCase();
    return value === "shop" || value === "shop app";
  };

  for (const row of rows) {
    const productId = String(row.shopify_product_id);
    try {
      const report = await readStorePublications(productId, policy);
      // A live run only ever touches products that are active in the store.
      // Draft, archived or otherwise non active products are left alone.
      if (!dryRun && report.status && report.status !== "active") {
        items.push({
          shopifyProductId: productId,
          title: report.title ?? row.title,
          status: report.status,
          currentChannels: report.currentChannels,
          desiredChannels: report.desiredChannels,
          toPublish: [],
          toUnpublish: [],
          drifted: report.drifted,
          changed: false,
          missingRequired: report.compliance.missingRequired,
          disallowedPresent: report.compliance.disallowedPresent,
          shopIneligible: null,
          compliant: report.compliance.compliant,
          message: "Skipped. The product is not active in the store",
        });
        continue;
      }
      let message = report.drifted
        ? "Drifted from the approved channel state"
        : "Already on the approved channels only";
      let didChange = false;
      let shopIneligible: string | null = null;
      let compliance = report.compliance;

      if (report.drifted) drifted += 1;
      if (report.currentChannels.some(isShopName)) shopAlready += 1;

      if (!dryRun && report.drifted) {
        const result = await ensureStorePublications(productId, policy, { removeUnwanted: true });
        message = result.message;
        didChange = result.published.length > 0 || result.unpublished.length > 0;
        if (didChange) changed += 1;
        if (result.published.some(isShopName)) shopPublished += 1;
        shopIneligible = result.shopIneligible;
        // Re-read so compliance reflects the store, not our intent.
        const after = await readStorePublications(productId, policy, {
          shopIneligibleReason: shopIneligible,
        });
        compliance = after.compliance;
      }

      if (shopIneligible) shopIneligibleCount += 1;
      if (compliance.compliant) compliantCount += 1;

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
        missingRequired: compliance.missingRequired,
        disallowedPresent: compliance.disallowedPresent,
        shopIneligible,
        compliant: compliance.compliant,
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
        missingRequired: [],
        disallowedPresent: [],
        shopIneligible: null,
        compliant: false,
        message: cause instanceof Error ? cause.message : "The channel state could not be read",
      });
    }
  }

  if (runId && items.length > 0) {
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
        message: item.shopIneligible
          ? `${item.message} | Shop exception: ${item.shopIneligible}`
          : item.message,
      })),
    );
  }

  if (runId) {
    await (supabase as any)
      .from("publication_audit_runs")
      .update({
        status: "complete",
        products_inspected: items.length,
        products_drifted: drifted,
        products_changed: changed,
        note: dryRun
          ? "Dry run. Nothing was changed in the store"
          : `Live reconciliation to ${desiredChannels.join(" + ")}`,
      })
      .eq("id", runId);
  }

  const total = typeof matchedCount === "number" ? matchedCount : null;
  const nextOffset =
    rows.length === limit && (total === null || offset + rows.length < total)
      ? offset + rows.length
      : null;

  return {
    runId,
    offset,
    nextOffset,
    totalMatched: total,
    mode: dryRun ? "dry_run" : "live",
    inspected: items.length,
    drifted,
    changed,
    shopAlready,
    shopPublished,
    shopIneligible: shopIneligibleCount,
    compliant: compliantCount,
    desiredChannels,
    items,
    note: dryRun
      ? "Dry run. Nothing was changed in the store"
      : `Live reconciliation to ${desiredChannels.join(" + ")}`,
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
              : "Off. NUR GOODS is the only browsing storefront",
          };
        }
        if (lower === "shop" || lower === "shop app") {
          return {
            name: channel.name,
            desired: policy.includeShopChannel,
            note: policy.includeShopChannel
              ? "Approved. Active products are discoverable and trackable in the Shop app"
              : "Off by policy",
          };
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
