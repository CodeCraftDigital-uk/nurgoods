import type { SupabaseClient } from "@supabase/supabase-js";
import { contentFingerprint, factsFingerprint, type ProductBundle, type ProductRow } from "./core.server";
import { classifyProduct, loadCategories } from "./classify.server";
import {
  MAX_REGENERATION_ATTEMPTS as MAX_SEO_REGENERATIONS,
  loadSeoContext,
  optimiseProduct,
  refreshProductFacts,
  seoInputHash,
} from "./seo.server";

import type { CategoryNode } from "./taxonomy";

/**
 * Intelligence work queue.
 *
 * Sync, webhooks, backfill and the daily maintenance job all express work the
 * same way: a queued row per product and stage. The queue carries a partial
 * unique index on open work, so a repeated sync or a duplicated scheduler call
 * cannot create a second run for the same product.
 */

type Db = SupabaseClient<any, "public", any>;

export type Stage = "classify" | "seo" | "facts" | "dedupe" | "elect";

const MAX_ATTEMPTS = 3;
const LOCK_TIMEOUT_MS = 10 * 60_000;

const PRODUCT_COLUMNS =
  "id, handle, title, description, description_html, product_type, vendor, tags, options, featured_image_url, price_min, price_max, currency, available_for_sale, total_inventory, variant_count, seo_title, seo_description, status, shopify_updated_at";

/** Loads everything the intelligence stages need for a set of products. */
export async function loadBundles(db: Db, productIds: string[]): Promise<ProductBundle[]> {
  if (productIds.length === 0) return [];

  const [products, media, variants, joins] = await Promise.all([
    db.from("shopify_products").select(PRODUCT_COLUMNS).in("id", productIds),
    db.from("shopify_product_media").select("product_id, url, alt_text, position").in("product_id", productIds),
    db
      .from("shopify_product_variants")
      .select("product_id, title, price, available_for_sale, selected_options, sku, barcode, position")
      .in("product_id", productIds),
    db.from("shopify_product_collections").select("product_id, collection_id").in("product_id", productIds),
  ]);

  const collectionIds = [...new Set(((joins.data ?? []) as any[]).map((row) => row.collection_id))];
  let collectionsById = new Map<string, { handle: string; title: string }>();
  if (collectionIds.length > 0) {
    const { data } = await db.from("shopify_collections").select("id, handle, title").in("id", collectionIds);
    collectionsById = new Map(((data ?? []) as any[]).map((row) => [row.id, { handle: row.handle, title: row.title }]));
  }

  const mediaByProduct = new Map<string, ProductBundle["media"]>();
  for (const row of ((media.data ?? []) as any[]).sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
    const list = mediaByProduct.get(row.product_id) ?? [];
    list.push({ url: row.url, alt_text: row.alt_text ?? null });
    mediaByProduct.set(row.product_id, list);
  }

  const variantsByProduct = new Map<string, ProductBundle["variants"]>();
  for (const row of ((variants.data ?? []) as any[]).sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
    const list = variantsByProduct.get(row.product_id) ?? [];
    list.push({
      title: row.title,
      price: row.price ?? null,
      available_for_sale: row.available_for_sale ?? null,
      selected_options: row.selected_options ?? [],
      sku: row.sku ?? null,
      barcode: row.barcode ?? null,
    });
    variantsByProduct.set(row.product_id, list);
  }

  const collectionsByProduct = new Map<string, ProductBundle["collections"]>();
  for (const row of ((joins.data ?? []) as any[])) {
    const collection = collectionsById.get(row.collection_id);
    if (!collection) continue;
    const list = collectionsByProduct.get(row.product_id) ?? [];
    list.push(collection);
    collectionsByProduct.set(row.product_id, list);
  }

  return ((products.data ?? []) as ProductRow[]).map((product) => ({
    product,
    media: mediaByProduct.get(product.id) ?? [],
    variants: variantsByProduct.get(product.id) ?? [],
    collections: collectionsByProduct.get(product.id) ?? [],
  }));
}

export interface QueueItem {
  productId: string;
  stage: Stage;
  reason: string;
  priority?: number;
}

/** Adds work. Open duplicates are silently ignored by the unique index. */
export async function enqueue(db: Db, items: QueueItem[]): Promise<number> {
  let added = 0;
  for (const item of items) {
    const { error } = await db.from("intelligence_queue").insert({
      product_id: item.productId,
      stage: item.stage,
      reason: item.reason.slice(0, 300),
      priority: item.priority ?? 100,
      status: "queued",
    } as never);
    if (!error) added += 1;
  }
  return added;
}

export interface PlanResult {
  inspected: number;
  queued: number;
  classify: number;
  seo: number;
  facts: number;
  unchanged: number;
}

/**
 * Material change detection. Compares stored fingerprints against the current
 * mirrored record so a price or stock movement never books a model run.
 */
export async function planWork(
  db: Db,
  productIds: string[],
  reason: string,
  options?: { force?: boolean },
): Promise<PlanResult> {
  const bundles = await loadBundles(db, productIds);
  if (bundles.length === 0) {
    return { inspected: 0, queued: 0, classify: 0, seo: 0, facts: 0, unchanged: 0 };
  }

  const ids = bundles.map((bundle) => bundle.product.id);
  const [{ data: classifications }, { data: intelligence }] = await Promise.all([
    db.from("product_classifications").select("product_id, input_fingerprint, category_slug").in("product_id", ids),
    db
      .from("product_seo_intelligence")
      .select("product_id, input_hash, schema_inputs, validation_state, regeneration_attempts, intelligence_version")
      .in("product_id", ids),
  ]);

  const classifiedBy = new Map(((classifications ?? []) as any[]).map((row) => [row.product_id, row]));
  const seoBy = new Map(((intelligence ?? []) as any[]).map((row) => [row.product_id, row]));

  const items: QueueItem[] = [];
  const counts = { classify: 0, seo: 0, facts: 0, unchanged: 0 };

  for (const bundle of bundles) {
    const id = bundle.product.id;
    const content = contentFingerprint(bundle);
    const facts = factsFingerprint(bundle);
    const classification = classifiedBy.get(id);
    const seo = seoBy.get(id);

    const needsClassify = options?.force || !classification || classification.input_fingerprint !== content;
    const expectedSeoHash = seoInputHash(bundle, classification?.category_slug ?? null);
    // A record parked for a person, or one that has already burnt its retries
    // on unchanged source data, is never requeued. Requeueing those is what
    // previously filled the queue and starved genuinely new work.
    const parked =
      Boolean(seo) &&
      seo.input_hash === expectedSeoHash &&
      (seo.validation_state === "manual_review" ||
        Number(seo.regeneration_attempts ?? 0) >= MAX_SEO_REGENERATIONS);
    const retryRejected =
      Boolean(seo) && seo.validation_state === "rejected" && !parked && seo.input_hash === expectedSeoHash;
    const needsSeo =
      !parked &&
      (options?.force || !seo || seo.input_hash !== expectedSeoHash || retryRejected || needsClassify);

    const factsChanged = Boolean(seo) && (seo.schema_inputs?.facts_fingerprint ?? null) !== facts;

    if (needsClassify) {
      items.push({ productId: id, stage: "classify", reason, priority: classification ? 100 : 50 });
      counts.classify += 1;
      // Identifiers, variants or imagery may have moved, so identity is rechecked.
      items.push({ productId: id, stage: "dedupe", reason, priority: 150 });
    }
    if (needsSeo) {
      items.push({ productId: id, stage: "seo", reason, priority: seo ? 110 : 60 });
      counts.seo += 1;
    } else if (factsChanged) {
      // Commercial values only, so the offer block is refreshed without a
      // model run.
      items.push({ productId: id, stage: "facts", reason: "Price or stock change", priority: 40 });
      counts.facts += 1;
      // Price or availability can change which listing should be canonical.
      items.push({ productId: id, stage: "elect", reason: "Price or stock change", priority: 45 });
    }
    if (!needsClassify && !needsSeo && !factsChanged) counts.unchanged += 1;
  }

  const queued = await enqueue(db, items);
  return { inspected: bundles.length, queued, ...counts };
}

/** Convenience wrapper used by the catalogue sync. */
export async function planWorkForHandles(db: Db, handles: string[], reason: string): Promise<PlanResult> {
  if (handles.length === 0) return { inspected: 0, queued: 0, classify: 0, seo: 0, facts: 0, unchanged: 0 };
  const { data } = await db.from("shopify_products").select("id").in("handle", handles.slice(0, 500));
  return planWork(db, ((data ?? []) as any[]).map((row) => row.id as string), reason);
}

/* ------------------------------------------------------------------ */
/* Processing                                                          */
/* ------------------------------------------------------------------ */

interface ClaimedRow {
  id: string;
  product_id: string;
  stage: Stage;
  attempts: number;
  reason: string | null;
}

async function claimBatch(db: Db, limit: number): Promise<ClaimedRow[]> {
  // Release locks left behind by an interrupted worker. A row can be left
  // running with no lock stamp at all when the worker died between the claim
  // and the stamp, so those are reclaimed too rather than stranded forever.
  const staleBefore = new Date(Date.now() - LOCK_TIMEOUT_MS).toISOString();
  await db
    .from("intelligence_queue")
    .update({ status: "queued", locked_at: null, lock_token: null } as never)
    .eq("status", "running")
    .or(`locked_at.is.null,locked_at.lt.${staleBefore}`);

  const { data: candidates } = await db
    .from("intelligence_queue")
    .select("id, product_id, stage, attempts, reason")
    .eq("status", "queued")
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(limit);

  const rows = (candidates ?? []) as ClaimedRow[];
  if (rows.length === 0) return [];

  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const { data: claimed } = await db
    .from("intelligence_queue")
    .update({ status: "running", locked_at: new Date().toISOString(), lock_token: token } as never)
    .in(
      "id",
      rows.map((row) => row.id),
    )
    .eq("status", "queued")
    .select("id, product_id, stage, attempts, reason");

  return (claimed ?? []) as ClaimedRow[];
}

export interface ProcessResult {
  processed: number;
  classified: number;
  optimised: number;
  factsRefreshed: number;
  failed: number;
  remaining: number;
  corrections: number;
  fallbacks: number;
  identityPasses: number;
  elections: number;
}

/** Works through a bounded slice of the queue. Safe to call repeatedly. */
export async function processQueue(db: Db, limit = 8): Promise<ProcessResult> {
  const claimed = await claimBatch(db, limit);
  const result: ProcessResult = {
    processed: 0,
    classified: 0,
    optimised: 0,
    factsRefreshed: 0,
    failed: 0,
    remaining: 0,
    corrections: 0,
    fallbacks: 0,
    identityPasses: 0,
    elections: 0,
  };

  if (claimed.length > 0) {
    // Category first, always. Search wording depends on the canonical category,
    // so a queued search item never runs ahead of a pending classification.
    const stageOrder: Record<Stage, number> = { classify: 0, dedupe: 1, seo: 2, facts: 3, elect: 4 };
    claimed.sort((a, b) => stageOrder[a.stage] - stageOrder[b.stage]);
    const classifiedNow = new Set(
      claimed.filter((row) => row.stage === "classify").map((row) => row.product_id),
    );
    const blockedProducts = new Set<string>();
    const seoProducts = claimed
      .filter((row) => row.stage === "seo" || row.stage === "facts")
      .map((row) => row.product_id)
      .filter((id) => !classifiedNow.has(id));
    if (seoProducts.length > 0) {
      const { data: pendingClassify } = await db
        .from("intelligence_queue")
        .select("product_id")
        .eq("stage", "classify")
        .in("status", ["queued", "running"])
        .in("product_id", seoProducts);
      for (const row of ((pendingClassify ?? []) as any[])) blockedProducts.add(row.product_id as string);
    }
    let dedupeDone = false;
    let electDone = false;

    const categories = await loadCategories(db);
    const bySlug = new Map(categories.map((node) => [node.slug, node]));
    const bundles = await loadBundles(db, [...new Set(claimed.map((row) => row.product_id))]);
    const bundleById = new Map(bundles.map((bundle) => [bundle.product.id, bundle]));
    let seoContext: Awaited<ReturnType<typeof loadSeoContext>> | null = null;

    for (const row of claimed) {
      const bundle = bundleById.get(row.product_id);
      if (
        (row.stage === "seo" || row.stage === "facts") &&
        blockedProducts.has(row.product_id)
      ) {
        // Released untouched, with no attempt spent, until the category lands.
        await db
          .from("intelligence_queue")
          .update({ status: "queued", locked_at: null, lock_token: null } as never)
          .eq("id", row.id);
        continue;
      }
      try {
        if (row.stage === "dedupe" || row.stage === "elect") {
          const { runDuplicateIdentity, reelectCanonicals } = await import("./dedupe.server");
          if (row.stage === "dedupe") {
            // One catalogue wide pass satisfies every queued identity item.
            if (!dedupeDone) {
              await runDuplicateIdentity(db);
              dedupeDone = true;
            }
            result.identityPasses = dedupeDone ? 1 : 0;
          } else {
            if (!electDone) {
              await reelectCanonicals(db);
              electDone = true;
            }
            result.elections += 1;
          }
          await db
            .from("intelligence_queue")
            .update({
              status: "succeeded",
              processed_at: new Date().toISOString(),
              locked_at: null,
              lock_token: null,
              last_error: null,
            } as never)
            .eq("id", row.id);
          result.processed += 1;
          continue;
        }

        if (!bundle) throw new Error("The mirrored product row no longer exists");

        if (row.stage === "classify") {
          const outcome = await classifyProduct(db, bundle, categories);
          result.classified += 1;
          if (outcome.corrected) result.corrections += 1;
          if (outcome.tier === "low") result.fallbacks += 1;
          // Wording depends on the canonical category, so refresh it next.
          await enqueue(db, [
            { productId: row.product_id, stage: "seo", reason: "Category was refreshed", priority: 90 },
          ]);
        } else if (row.stage === "seo") {
          seoContext ??= await loadSeoContext(db);
          const { data: classification } = await db
            .from("product_classifications")
            .select("category_slug")
            .eq("product_id", row.product_id)
            .maybeSingle();
          const category = (classification as any)?.category_slug
            ? (bySlug.get((classification as any).category_slug) ?? null)
            : null;
          await optimiseProduct(db, bundle, category, categories, seoContext);
          result.optimised += 1;
        } else {
          const { data: classification } = await db
            .from("product_classifications")
            .select("category_slug")
            .eq("product_id", row.product_id)
            .maybeSingle();
          const category = (classification as any)?.category_slug
            ? (bySlug.get((classification as any).category_slug) ?? null)
            : null;
          await refreshProductFacts(db, bundle, category);
          result.factsRefreshed += 1;
        }

        await db
          .from("intelligence_queue")
          .update({
            status: "succeeded",
            processed_at: new Date().toISOString(),
            locked_at: null,
            lock_token: null,
            last_error: null,
          } as never)
          .eq("id", row.id);
        result.processed += 1;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "The intelligence stage failed";
        const attempts = (row.attempts ?? 0) + 1;
        await db
          .from("intelligence_queue")
          .update({
            status: attempts >= MAX_ATTEMPTS ? "failed" : "queued",
            attempts,
            last_error: message.slice(0, 500),
            locked_at: null,
            lock_token: null,
            ...(attempts >= MAX_ATTEMPTS ? { processed_at: new Date().toISOString() } : {}),
          } as never)
          .eq("id", row.id);
        result.failed += 1;
      }
    }
  }

  const { count } = await db
    .from("intelligence_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "queued");
  result.remaining = count ?? 0;
  return result;
}

export type { CategoryNode };
