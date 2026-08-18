import type { SupabaseClient } from "@supabase/supabase-js";
import { loadBundles } from "@/lib/intelligence/queue.server";
import { validateIntake } from "./validate";
import {
  DEFAULT_INTAKE_POLICY,
  type IntakeCounters,
  type IntakePolicy,
  type IntakeSource,
  type IntakeState,
} from "./types";

/**
 * The intake engine.
 *
 * Detection is idempotent on the Shopify product identifier plus its version,
 * so a webhook and the scheduled delta sync cannot create two jobs for the same
 * product revision. Processing is per product and every failure is contained,
 * so one bad supplier record can never stop the queue.
 */

type Db = SupabaseClient<any, "public", any>;

export function versionFingerprint(shopifyProductId: string, updatedAt: string | null): string {
  return `${shopifyProductId}@${updatedAt ?? ""}`;
}

export async function getIntakePolicy(db: Db): Promise<IntakePolicy> {
  const { data } = await db.from("product_intake_policy").select("*").eq("id", "default").maybeSingle();
  if (!data) return { ...DEFAULT_INTAKE_POLICY };
  const row = data as any;
  const out = { ...DEFAULT_INTAKE_POLICY };
  for (const key of Object.keys(out) as (keyof IntakePolicy)[]) {
    if (typeof row[key] === "boolean") out[key] = row[key];
  }
  return out;
}

async function logEvent(
  db: Db,
  intakeId: string,
  shopifyProductId: string | null,
  fromState: IntakeState | null,
  toState: IntakeState,
  reasonCode: string | null,
  message: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  await db.from("product_intake_events").insert({
    intake_id: intakeId,
    shopify_product_id: shopifyProductId,
    from_state: fromState,
    to_state: toState,
    reason_code: reasonCode,
    message,
    detail: detail as never,
  } as never);
}

const STATE_TIMESTAMP: Partial<Record<IntakeState, string>> = {
  validating: "validated_at",
  duplicate_check: "identity_at",
  classification: "classified_at",
  seo: "seo_at",
  approved: "approved_at",
  published_to_storefront: "published_at",
  quarantined: "quarantined_at",
  rejected: "rejected_at",
  failed: "failed_at",
};

async function transition(
  db: Db,
  record: { id: string; state: IntakeState; shopify_product_id: string },
  toState: IntakeState,
  reasonCode: string | null,
  reason: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    previous_state: record.state,
    state: toState,
    reason_code: reasonCode,
    reason,
    last_transition_at: now,
    ...extra,
  };
  const stamp = STATE_TIMESTAMP[toState];
  if (stamp) patch[stamp] = now;
  await db.from("product_intake_records").update(patch as never).eq("id", record.id);
  await logEvent(db, record.id, record.shopify_product_id, record.state, toState, reasonCode, reason);
  record.state = toState;
}

export interface DetectionInput {
  shopifyProductId: string;
  title?: string | null;
  handle?: string | null;
  productId?: string | null;
  updatedAt?: string | null;
  source: IntakeSource;
  /** Hash of the catalogue content intake actually reasons about. */
  materialFingerprint?: string | null;
  origin?: IntakeOrigin;
}

export interface DetectionResult {
  created: number;
  requeued: number;
  unchanged: number;
}

/**
 * Records newly seen or newly changed products.
 *
 * A record whose material catalogue content has not moved is never sent back
 * through the pipeline. Price, stock and routine sync timestamp movement are
 * recorded quietly instead, which is what keeps a published product from being
 * reclassified and reoptimised for no reason.
 */
export async function detectProducts(db: Db, inputs: DetectionInput[]): Promise<DetectionResult> {
  const result: DetectionResult = { created: 0, requeued: 0, unchanged: 0 };
  if (inputs.length === 0) return result;

  const ids = [...new Set(inputs.map((item) => item.shopifyProductId))];
  const { data: existing } = await db
    .from("product_intake_records")
    .select(
      "id, shopify_product_id, product_id, title, handle, state, version_fingerprint, processed_fingerprint, material_fingerprint",
    )
    .in("shopify_product_id", ids);
  const byShopifyId = new Map(((existing ?? []) as any[]).map((row) => [row.shopify_product_id, row]));

  for (const input of inputs) {
    const fingerprint = versionFingerprint(input.shopifyProductId, input.updatedAt ?? null);
    const material = input.materialFingerprint ?? null;
    const row = byShopifyId.get(input.shopifyProductId);

    const decision = decideRequeue({
      existing: row ?? null,
      versionFingerprint: fingerprint,
      materialFingerprint: material,
      hasVersion: Boolean(input.updatedAt),
    });

    if (decision.action === "create") {
      const { data: inserted } = await db
        .from("product_intake_records")
        .insert({
          shopify_product_id: input.shopifyProductId,
          product_id: input.productId ?? null,
          title: input.title ?? null,
          handle: input.handle ?? null,
          source: input.source,
          origin: input.origin ?? "store",
          state: "detected",
          reason_code: "detected",
          reason: `Detected from ${input.source === "webhook" ? "a store webhook" : "the scheduled sync"}`,
          version_fingerprint: fingerprint,
          material_fingerprint: material,
        } as never)
        .select("id")
        .maybeSingle();
      if (inserted) {
        result.created += 1;
        await logEvent(
          db,
          (inserted as any).id,
          input.shopifyProductId,
          null,
          "detected",
          "detected",
          "New product detected",
        );
      }
      continue;
    }

    if (decision.action === "skip") {
      result.unchanged += 1;
      continue;
    }

    if (decision.action === "touch") {
      // Nothing material moved, so the record keeps its state and only the
      // fingerprints are refreshed.
      await db
        .from("product_intake_records")
        .update({
          version_fingerprint: fingerprint,
          material_fingerprint: material ?? row.material_fingerprint ?? null,
          title: input.title ?? row.title ?? null,
          handle: input.handle ?? row.handle ?? null,
          product_id: input.productId ?? row.product_id ?? null,
        } as never)
        .eq("id", row.id);
      result.unchanged += 1;
      continue;
    }

    await db
      .from("product_intake_records")
      .update({
        product_id: input.productId ?? row.product_id ?? null,
        title: input.title ?? row.title ?? null,
        handle: input.handle ?? row.handle ?? null,
        source: input.source,
        ...(input.origin ? { origin: input.origin } : {}),
        state: "detected",
        previous_state: row.state,
        reason_code: "changed",
        reason: decision.reason,
        version_fingerprint: fingerprint,
        material_fingerprint: material,
        attempts: 0,
        locked_at: null,
        lock_token: null,
        last_transition_at: new Date().toISOString(),
      } as never)
      .eq("id", row.id);
    await logEvent(
      db,
      row.id,
      input.shopifyProductId,
      row.state,
      "detected",
      "changed",
      decision.reason,
    );
    result.requeued += 1;
  }

  return result;
}

export interface IntakeProcessResult {
  processed: number;
  approved: number;
  published: number;
  quarantined: number;
  failed: number;
  classified: number;
  optimised: number;
  identityPasses: number;
}

/** Products waiting for work, oldest first. */
async function claimIntake(db: Db, limit: number): Promise<any[]> {
  await db
    .from("product_intake_records")
    .update({ locked_at: null, lock_token: null } as never)
    .not("locked_at", "is", null)
    .lt("locked_at", new Date(Date.now() - 10 * 60_000).toISOString());

  const workable: IntakeState[] = ["detected", "validating", "duplicate_check", "classification", "seo", "approved"];
  const { data } = await db
    .from("product_intake_records")
    .select("id, shopify_product_id, product_id, title, handle, state, attempts, version_fingerprint")
    .in("state", workable)
    .is("locked_at", null)
    .order("detected_at", { ascending: true })
    .limit(limit);
  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const { data: claimed } = await db
    .from("product_intake_records")
    .update({ locked_at: new Date().toISOString(), lock_token: token } as never)
    .in(
      "id",
      rows.map((row) => row.id),
    )
    .is("lock_token", null)
    .select("id, shopify_product_id, product_id, title, handle, state, attempts, version_fingerprint");
  return (claimed ?? rows) as any[];
}

async function release(db: Db, id: string, patch: Record<string, unknown> = {}): Promise<void> {
  await db
    .from("product_intake_records")
    .update({ locked_at: null, lock_token: null, ...patch } as never)
    .eq("id", id);
}

/**
 * Moves claimed products through validation, identity, classification and
 * search intelligence. Each product is handled inside its own try block.
 */
export async function processIntake(db: Db, limit = 6): Promise<IntakeProcessResult> {
  const result: IntakeProcessResult = {
    processed: 0,
    approved: 0,
    published: 0,
    quarantined: 0,
    failed: 0,
    classified: 0,
    optimised: 0,
    identityPasses: 0,
  };

  const policy = await getIntakePolicy(db);
  if (!policy.automatic_processing) return result;

  const claimed = await claimIntake(db, limit);
  if (claimed.length === 0) return result;

  // Resolve mirrored product rows for anything detected before the mirror
  // caught up.
  const missingProductIds = claimed.filter((row) => !row.product_id);
  if (missingProductIds.length > 0) {
    const { data: mirrored } = await db
      .from("shopify_products")
      .select("id, shopify_product_id, title, handle")
      .in(
        "shopify_product_id",
        missingProductIds.map((row) => row.shopify_product_id),
      );
    const map = new Map(((mirrored ?? []) as any[]).map((row) => [row.shopify_product_id, row]));
    for (const row of claimed) {
      const match = map.get(row.shopify_product_id);
      if (match) {
        row.product_id = match.id;
        row.title = row.title ?? match.title;
        row.handle = row.handle ?? match.handle;
        await db
          .from("product_intake_records")
          .update({ product_id: match.id, title: match.title, handle: match.handle } as never)
          .eq("id", row.id);
      }
    }
  }

  const productIds = claimed.map((row) => row.product_id).filter(Boolean) as string[];
  const bundles = await loadBundles(db, productIds);
  const bundleById = new Map(bundles.map((bundle) => [bundle.product.id, bundle]));

  let identityRan = false;
  let categories: Awaited<ReturnType<typeof import("@/lib/intelligence/classify.server").loadCategories>> | null = null;
  let seoContext: Awaited<ReturnType<typeof import("@/lib/intelligence/seo.server").loadSeoContext>> | null = null;

  for (const row of claimed) {
    try {
      if (!row.product_id) {
        await transition(db, row, "quarantined", "not_mirrored", "The store record has not reached the catalogue mirror yet");
        result.quarantined += 1;
        await release(db, row.id);
        continue;
      }
      const bundle = bundleById.get(row.product_id);
      if (!bundle) {
        await transition(db, row, "quarantined", "not_mirrored", "The mirrored catalogue row could not be read");
        result.quarantined += 1;
        await release(db, row.id);
        continue;
      }

      // 1. Deterministic validation.
      await transition(db, row, "validating", "validating", "Running deterministic quality checks");
      const outcome = validateIntake(bundle, policy);
      await db
        .from("product_intake_records")
        .update({ validation: { checks: outcome.checks } as never })
        .eq("id", row.id);
      if (!outcome.passed) {
        await transition(
          db,
          row,
          "quarantined",
          outcome.failedCodes[0] ?? "validation_failed",
          outcome.summary,
          { processed_fingerprint: row.version_fingerprint },
        );
        result.quarantined += 1;
        result.processed += 1;
        await release(db, row.id);
        continue;
      }

      // 2. Product identity and de-duplication. Only the existing high
      // confidence structured rules may suppress anything.
      await transition(db, row, "duplicate_check", "identity", "Checking product identity against the catalogue");
      if (policy.duplicate_protection && !identityRan) {
        const { runDuplicateIdentity } = await import("@/lib/intelligence/dedupe.server");
        await runDuplicateIdentity(db);
        identityRan = true;
        result.identityPasses = 1;
      }

      // 3. Canonical NUR GOODS taxonomy.
      await transition(db, row, "classification", "classification", "Assigning the canonical NUR GOODS category");
      if (policy.catalogue_classification) {
        const { classifyProduct, loadCategories } = await import("@/lib/intelligence/classify.server");
        categories ??= await loadCategories(db);
        await classifyProduct(db, bundle, categories);
        result.classified += 1;
      }

      // 4. Search intelligence.
      await transition(db, row, "seo", "seo", "Producing search intelligence");
      if (policy.seo_intelligence) {
        const { loadSeoContext, optimiseProduct } = await import("@/lib/intelligence/seo.server");
        const { loadCategories } = await import("@/lib/intelligence/classify.server");
        categories ??= await loadCategories(db);
        seoContext ??= await loadSeoContext(db);
        const { data: classification } = await db
          .from("product_classifications")
          .select("category_slug")
          .eq("product_id", row.product_id)
          .maybeSingle();
        const slug = (classification as any)?.category_slug ?? null;
        const category = slug ? (categories.find((node) => node.slug === slug) ?? null) : null;
        await optimiseProduct(db, bundle, category, categories, seoContext);
        result.optimised += 1;
      }

      // 5. Approval and exposure.
      await transition(db, row, "approved", "approved", "Every required intake gate passed", {
        processed_fingerprint: row.version_fingerprint,
      });
      result.approved += 1;
      if (policy.automatic_storefront_exposure) {
        await transition(
          db,
          row,
          "published_to_storefront",
          "published",
          "Visible through the NUR GOODS catalogue and search",
        );
        result.published += 1;
      }
      result.processed += 1;
      await release(db, row.id);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The intake stage failed";
      const attempts = (row.attempts ?? 0) + 1;
      const failed = attempts >= 3;
      await db
        .from("product_intake_records")
        .update({
          attempts,
          state: failed ? "failed" : "detected",
          reason_code: failed ? "stage_failed" : "retrying",
          reason: message,
          last_transition_at: new Date().toISOString(),
          failed_at: failed ? new Date().toISOString() : null,
          locked_at: null,
          lock_token: null,
        } as never)
        .eq("id", row.id);
      await logEvent(
        db,
        row.id,
        row.shopify_product_id,
        row.state,
        failed ? "failed" : "detected",
        failed ? "stage_failed" : "retrying",
        message,
      );
      if (failed) result.failed += 1;
      result.processed += 1;
    }
  }

  return result;
}

/** Puts a quarantined or failed product back at the start of intake. */
export async function retryIntake(db: Db, intakeId: string): Promise<void> {
  const { data } = await db
    .from("product_intake_records")
    .select("id, state, shopify_product_id")
    .eq("id", intakeId)
    .maybeSingle();
  if (!data) throw new Error("That intake record does not exist");
  const row = data as any;
  if (!["quarantined", "failed", "rejected"].includes(row.state)) {
    throw new Error("Only quarantined, failed or rejected products can be reprocessed");
  }
  await db
    .from("product_intake_records")
    .update({
      state: "detected",
      previous_state: row.state,
      reason_code: "manual_retry",
      reason: "Reprocess requested from the control plane",
      attempts: 0,
      processed_fingerprint: null,
      locked_at: null,
      lock_token: null,
      last_transition_at: new Date().toISOString(),
    } as never)
    .eq("id", intakeId);
  await logEvent(db, intakeId, row.shopify_product_id, row.state, "detected", "manual_retry", "Reprocess requested");
}

export async function intakeCounters(db: Db): Promise<IntakeCounters> {
  const count = async (states: IntakeState[]) => {
    const { count: value } = await db
      .from("product_intake_records")
      .select("id", { count: "exact", head: true })
      .in("state", states);
    return value ?? 0;
  };

  const [detected, processing, approved, published, quarantined, rejected, failed] = await Promise.all([
    count(["detected"]),
    count(["validating", "duplicate_check", "classification", "seo"]),
    count(["approved"]),
    count(["published_to_storefront"]),
    count(["quarantined"]),
    count(["rejected"]),
    count(["failed"]),
  ]);

  const [{ count: suppressed }, { count: seoDone }, { data: corrections }] = await Promise.all([
    db.from("duplicate_group_members").select("id", { count: "exact", head: true }).eq("suppressed", true),
    db.from("product_seo_intelligence").select("id", { count: "exact", head: true }).eq("auto_published", true),
    db.from("product_classification_history").select("id").eq("source", "auto").limit(1000),
  ]);

  return {
    detected,
    processing,
    approved,
    published,
    quarantined,
    rejected,
    failed,
    duplicates_suppressed: suppressed ?? 0,
    category_corrections: ((corrections ?? []) as any[]).length,
    seo_completed: seoDone ?? 0,
  };
}
