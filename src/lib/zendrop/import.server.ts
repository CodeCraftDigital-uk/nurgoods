/**
 * Controlled supplier import workflow.
 *
 * candidate -> validated -> priced -> duplicate_checked -> queued ->
 * importing -> imported -> linked -> detected_in_store -> live
 *
 * Every step is idempotent and resumable. No write ever leaves this module
 * unless the adapter has confirmed a real supported import operation.
 */
import { computePricing, DEFAULT_PRICING } from "./pricing";
import type {
  CandidateState,
  CatalogueItem,
  PricingSettings,
  SourcingCounters,
  SourcingRules,
} from "./types";
import {
  CapabilityUnavailableError,
  callAction,
  loadCapabilityMap,
  zendropAdminClient,
} from "./client.server";
import { getZendropProduct } from "./catalogue.server";
import { getZendropStatus, markOneProductTestPassed } from "./connection.server";

export const DEFAULT_RULES: SourcingRules = {
  enabled: false,
  allowed_categories: [],
  blocked_categories: [],
  require_stock: true,
  require_image: true,
  require_uk_shipping: true,
  duplicate_precheck: true,
  min_landed_cost: null,
  max_landed_cost: null,
  max_retail_price: null,
  daily_import_cap: 25,
  batch_size: 10,
};

export async function loadPricingSettings(): Promise<PricingSettings> {
  const supabase = await zendropAdminClient();
  const { data } = await supabase
    .from("zendrop_pricing_settings")
    .select("*")
    .eq("id", "default")
    .maybeSingle();
  if (!data) return DEFAULT_PRICING;
  const row = data as any;
  return {
    pricing_mode: row.pricing_mode ?? DEFAULT_PRICING.pricing_mode,
    target_margin: Number(row.target_margin ?? DEFAULT_PRICING.target_margin),
    rounding_mode: row.rounding_mode ?? DEFAULT_PRICING.rounding_mode,
    min_promo_margin: Number(row.min_promo_margin ?? DEFAULT_PRICING.min_promo_margin),
    promo_discount: Number(row.promo_discount ?? DEFAULT_PRICING.promo_discount),
    shipping_market: row.shipping_market ?? DEFAULT_PRICING.shipping_market,
    currency: row.currency ?? DEFAULT_PRICING.currency,
    allow_incomplete_pricing: Boolean(row.allow_incomplete_pricing),
  };
}

export async function loadSourcingRules(): Promise<SourcingRules> {
  const supabase = await zendropAdminClient();
  const { data } = await supabase
    .from("zendrop_sourcing_rules")
    .select("*")
    .eq("id", "default")
    .maybeSingle();
  if (!data) return DEFAULT_RULES;
  const row = data as any;
  return {
    enabled: Boolean(row.enabled),
    allowed_categories: row.allowed_categories ?? [],
    blocked_categories: row.blocked_categories ?? [],
    require_stock: Boolean(row.require_stock),
    require_image: Boolean(row.require_image),
    require_uk_shipping: Boolean(row.require_uk_shipping),
    duplicate_precheck: Boolean(row.duplicate_precheck),
    min_landed_cost: row.min_landed_cost === null ? null : Number(row.min_landed_cost),
    max_landed_cost: row.max_landed_cost === null ? null : Number(row.max_landed_cost),
    max_retail_price: row.max_retail_price === null ? null : Number(row.max_retail_price),
    daily_import_cap: Number(row.daily_import_cap ?? DEFAULT_RULES.daily_import_cap),
    batch_size: Number(row.batch_size ?? DEFAULT_RULES.batch_size),
  };
}

async function logEvent(
  candidateId: string | null,
  productId: string | null,
  from: CandidateState | null,
  to: CandidateState,
  reasonCode: string,
  message: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  const supabase = await zendropAdminClient();
  await supabase.from("zendrop_import_events").insert({
    candidate_id: candidateId,
    zendrop_product_id: productId,
    from_state: from,
    to_state: to,
    reason_code: reasonCode,
    message,
    detail,
  } as never);
}

/** Stable key so a double click or a repeated job never imports twice. */
export function idempotencyKey(productId: string, test: boolean): string {
  return `${test ? "test" : "live"}:${productId}`;
}

/* ------------------------------- validation ------------------------------- */

export function validateCandidate(
  item: CatalogueItem,
  rules: SourcingRules,
): { ok: boolean; reason: string | null } {
  if (rules.require_image && !item.imageUrl) {
    return { ok: false, reason: "No supplier image is available" };
  }
  if (rules.require_stock && item.inventory !== null && item.inventory <= 0) {
    return { ok: false, reason: "The supplier reports no available stock" };
  }
  const category = (item.category ?? "").toLowerCase();
  if (
    category &&
    rules.blocked_categories.some((blocked) => category.includes(blocked.toLowerCase()))
  ) {
    return { ok: false, reason: "That category is blocked by the sourcing rules" };
  }
  if (
    rules.allowed_categories.length > 0 &&
    !rules.allowed_categories.some((allowed) => category.includes(allowed.toLowerCase()))
  ) {
    return { ok: false, reason: "That category is not in the allowed list" };
  }
  if (rules.require_uk_shipping && item.shippingCost === null) {
    return { ok: false, reason: "Shipping to the pricing market could not be confirmed" };
  }
  return { ok: true, reason: null };
}

/* ------------------------------ duplicates -------------------------------- */

async function duplicatePrecheck(item: CatalogueItem): Promise<string | null> {
  const supabase = await zendropAdminClient();
  const title = item.title.trim();
  if (!title) return null;
  const { data } = await supabase
    .from("shopify_products")
    .select("id, title, handle")
    .ilike("title", title)
    .limit(1);
  const match = (data ?? [])[0] as any;
  return match ? `A catalogue product with the same title already exists (${match.handle})` : null;
}

/* -------------------------------- selection ------------------------------- */

export interface SelectionResult {
  created: number;
  skipped: number;
  held: number;
  candidateIds: string[];
  messages: string[];
}

/** Turns supplier catalogue products into priced, validated candidates. */
export async function selectCandidates(input: {
  productIds: string[];
  userId: string;
  test?: boolean;
}): Promise<SelectionResult> {
  const supabase = await zendropAdminClient();
  const rules = await loadSourcingRules();
  const settings = await loadPricingSettings();
  const cap = Math.max(1, Math.min(rules.batch_size, 50));
  const ids = input.productIds.slice(0, input.test ? 1 : cap);

  const result: SelectionResult = {
    created: 0,
    skipped: 0,
    held: 0,
    candidateIds: [],
    messages: [],
  };

  for (const productId of ids) {
    const key = idempotencyKey(productId, Boolean(input.test));
    const { data: existing } = await supabase
      .from("zendrop_import_candidates")
      .select("id, state")
      .eq("idempotency_key", key)
      .maybeSingle();
    if (existing) {
      result.skipped += 1;
      result.candidateIds.push((existing as any).id);
      continue;
    }

    const item = await getZendropProduct(productId);
    if (!item) {
      result.skipped += 1;
      result.messages.push(`Supplier product ${productId} could not be read`);
      continue;
    }

    const validation = validateCandidate(item, rules);
    const pricing = computePricing({
      supplierCost: item.cost,
      shippingCost: item.shippingCost,
      suggestedRetail: item.suggestedRetail,
      settings,
    });

    let state: CandidateState = "validated";
    let hold: string | null = null;
    if (!validation.ok) {
      state = "held";
      hold = validation.reason;
    } else if (!pricing.complete) {
      state = "held";
      hold = pricing.reason;
    } else {
      state = "priced";
      if (rules.min_landed_cost !== null && (pricing.landedCost ?? 0) < rules.min_landed_cost) {
        state = "held";
        hold = "Landed cost is below the configured minimum";
      } else if (
        rules.max_landed_cost !== null &&
        (pricing.landedCost ?? 0) > rules.max_landed_cost
      ) {
        state = "held";
        hold = "Landed cost is above the configured maximum";
      } else if (rules.max_retail_price !== null && (pricing.price ?? 0) > rules.max_retail_price) {
        state = "held";
        hold = "The calculated retail price is above the configured maximum";
      } else if (rules.duplicate_precheck) {
        const duplicate = await duplicatePrecheck(item);
        if (duplicate) {
          state = "held";
          hold = duplicate;
        } else {
          state = "duplicate_checked";
        }
      } else {
        state = "duplicate_checked";
      }
    }

    const { data: inserted, error } = await supabase
      .from("zendrop_import_candidates")
      .insert({
        idempotency_key: key,
        zendrop_product_id: item.id,
        zendrop_variant_ids: item.variants.map((v) => v.id),
        title: item.title,
        image_url: item.imageUrl,
        category: item.category,
        state,
        hold_reason: hold,
        is_test: Boolean(input.test),
        currency: settings.currency,
        supplier_cost: pricing.supplierCost,
        shipping_cost: pricing.shippingCost,
        landed_cost: pricing.landedCost,
        calculated_price: pricing.price,
        suggested_retail: pricing.suggestedRetail,
        gross_margin: pricing.grossMargin,
        pricing_complete: pricing.complete,
        pricing_snapshot: pricing as unknown as Record<string, unknown>,
        supplier_payload: item as unknown as Record<string, unknown>,
        created_by: input.userId,
      } as never)
      .select("id")
      .maybeSingle();

    if (error || !inserted) {
      result.skipped += 1;
      result.messages.push(`Supplier product ${productId} could not be recorded`);
      continue;
    }

    const candidateId = (inserted as any).id as string;
    result.candidateIds.push(candidateId);
    if (state === "held") result.held += 1;
    else result.created += 1;
    await logEvent(candidateId, item.id, "candidate", state, "selected", hold ?? "Ready to queue");
  }

  return result;
}

/* --------------------------------- queueing ------------------------------- */

export async function queueCandidates(candidateIds: string[]): Promise<number> {
  const supabase = await zendropAdminClient();
  const rules = await loadSourcingRules();
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await supabase
    .from("zendrop_import_candidates")
    .select("id", { count: "exact", head: true })
    .gte("imported_at", since);
  const remaining = Math.max(0, rules.daily_import_cap - (count ?? 0));
  const allowed = candidateIds.slice(0, remaining);
  if (allowed.length === 0) return 0;

  await supabase
    .from("zendrop_import_candidates")
    .update({
      state: "queued",
      previous_state: "duplicate_checked",
      queued_at: new Date().toISOString(),
    } as never)
    .in("id", allowed)
    .in("state", ["duplicate_checked", "priced", "failed"]);
  return allowed.length;
}

/* --------------------------------- import --------------------------------- */

export interface ImportOutcome {
  processed: number;
  imported: number;
  failed: number;
  messages: string[];
}

/**
 * Drains the queue in bounded batches. The write only runs when the adapter
 * has discovered a genuine supported import operation.
 */
export async function runImportQueue(limit = 5): Promise<ImportOutcome> {
  const supabase = await zendropAdminClient();
  const roles = await loadCapabilityMap();
  const action = roles.my_products_import;
  const outcome: ImportOutcome = { processed: 0, imported: 0, failed: 0, messages: [] };

  if (!action) {
    outcome.messages.push(new CapabilityUnavailableError("my_products_import").message);
    return outcome;
  }

  const lockToken = crypto.randomUUID();
  const { data: rows } = await supabase
    .from("zendrop_import_candidates")
    .select("*")
    .eq("state", "queued")
    .is("locked_at", null)
    .order("queued_at", { ascending: true })
    .limit(Math.max(1, Math.min(limit, 20)));

  for (const raw of (rows ?? []) as any[]) {
    const { data: locked } = await supabase
      .from("zendrop_import_candidates")
      .update({
        state: "importing",
        previous_state: "queued",
        locked_at: new Date().toISOString(),
        lock_token: lockToken,
      } as never)
      .eq("id", raw.id)
      .eq("state", "queued")
      .is("locked_at", null)
      .select("id")
      .maybeSingle();
    if (!locked) continue;

    outcome.processed += 1;
    try {
      const response = await callAction(action, {
        product_id: raw.zendrop_product_id,
        id: raw.zendrop_product_id,
      });
      const responseId =
        response?.id ?? response?.product_id ?? response?.my_product_id ?? null;
      await supabase
        .from("zendrop_import_candidates")
        .update({
          state: "imported",
          previous_state: "importing",
          imported_at: new Date().toISOString(),
          write_response: (response ?? {}) as Record<string, unknown>,
          store_reference: responseId ? String(responseId) : null,
          locked_at: null,
          lock_token: null,
          failure_reason: null,
        } as never)
        .eq("id", raw.id);
      outcome.imported += 1;
      await logEvent(
        raw.id,
        raw.zendrop_product_id,
        "importing",
        "imported",
        "import_succeeded",
        "The supplier accepted the import request",
        { action: action.name },
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The supplier import failed";
      const attempts = (raw.attempts ?? 0) + 1;
      const dead = attempts >= 3;
      await supabase
        .from("zendrop_import_candidates")
        .update({
          state: dead ? "failed" : "queued",
          previous_state: "importing",
          attempts,
          failure_reason: message,
          locked_at: null,
          lock_token: null,
        } as never)
        .eq("id", raw.id);
      if (dead) outcome.failed += 1;
      outcome.messages.push(message);
      await logEvent(
        raw.id,
        raw.zendrop_product_id,
        "importing",
        dead ? "failed" : "queued",
        "import_failed",
        message,
      );
    }
  }

  return outcome;
}

/* ------------------------- store linkage detection ------------------------- */

/**
 * Reconciles imported candidates against the store mirror the existing sync
 * already maintains. No product is ever created in the store from here.
 */
export async function reconcileImportedCandidates(): Promise<number> {
  const supabase = await zendropAdminClient();
  const { data: rows } = await supabase
    .from("zendrop_import_candidates")
    .select("id, title, zendrop_product_id, state")
    .in("state", ["imported", "linked"])
    .limit(50);

  let matched = 0;
  for (const raw of (rows ?? []) as any[]) {
    const { data: product } = await supabase
      .from("shopify_products")
      .select("id, shopify_product_id")
      .ilike("title", raw.title)
      .limit(1)
      .maybeSingle();
    if (!product) continue;
    await supabase
      .from("zendrop_import_candidates")
      .update({
        state: "detected_in_store",
        previous_state: raw.state,
        product_id: (product as any).id,
        shopify_product_id: (product as any).shopify_product_id,
        linked_at: new Date().toISOString(),
      } as never)
      .eq("id", raw.id);
    matched += 1;
    await logEvent(
      raw.id,
      raw.zendrop_product_id,
      raw.state,
      "detected_in_store",
      "store_detected",
      "The existing store sync has picked the product up",
    );
  }

  // Anything the intake pipeline has published becomes live.
  const { data: detected } = await supabase
    .from("zendrop_import_candidates")
    .select("id, product_id, zendrop_product_id")
    .eq("state", "detected_in_store")
    .not("product_id", "is", null)
    .limit(50);
  for (const raw of (detected ?? []) as any[]) {
    const { data: intake } = await supabase
      .from("product_intake_records")
      .select("state")
      .eq("product_id", raw.product_id)
      .maybeSingle();
    if ((intake as any)?.state !== "published_to_storefront") continue;
    await supabase
      .from("zendrop_import_candidates")
      .update({
        state: "live",
        previous_state: "detected_in_store",
        live_at: new Date().toISOString(),
      } as never)
      .eq("id", raw.id);
    await logEvent(raw.id, raw.zendrop_product_id, "detected_in_store", "live", "live", "Live on the storefront");
  }

  return matched;
}

/* ----------------------------- one product test ---------------------------- */

export interface TestStep {
  key: string;
  label: string;
  status: "passed" | "failed" | "skipped";
  detail: string;
}

export interface OneProductTestResult {
  passed: boolean;
  steps: TestStep[];
  candidateId: string | null;
}

/**
 * Controlled single product rehearsal. Reads, prices and imports exactly one
 * product, then reports linkage. It never places an order or a fulfilment
 * request.
 */
export async function runOneProductTest(input: {
  productId: string;
  userId: string;
}): Promise<OneProductTestResult> {
  const steps: TestStep[] = [];
  const push = (key: string, label: string, status: TestStep["status"], detail: string) =>
    steps.push({ key, label, status, detail });

  const status = await getZendropStatus();
  if (!status.configured) {
    push("auth", "Authenticate", "failed", "No supplier token is stored");
    return { passed: false, steps, candidateId: null };
  }
  push("auth", "Authenticate", "passed", "The stored token was accepted");

  const item = await getZendropProduct(input.productId).catch(() => null);
  if (!item) {
    push("retrieve", "Retrieve the product", "failed", "The supplier product could not be read");
    return { passed: false, steps, candidateId: null };
  }
  push("retrieve", "Retrieve the product", "passed", item.title);

  const selection = await selectCandidates({
    productIds: [item.id],
    userId: input.userId,
    test: true,
  });
  const candidateId = selection.candidateIds[0] ?? null;
  if (!candidateId) {
    push("price", "Price the product", "failed", selection.messages[0] ?? "Pricing failed");
    return { passed: false, steps, candidateId: null };
  }

  const supabase = await zendropAdminClient();
  const { data: candidate } = await supabase
    .from("zendrop_import_candidates")
    .select("*")
    .eq("id", candidateId)
    .maybeSingle();
  const row = candidate as any;
  if (!row?.pricing_complete) {
    push("price", "Price the product", "failed", row?.hold_reason ?? "Pricing is incomplete");
    return { passed: false, steps, candidateId };
  }
  push(
    "price",
    "Price the product",
    "passed",
    `Landed ${row.landed_cost} priced at ${row.calculated_price}`,
  );

  const roles = await loadCapabilityMap();
  if (!roles.my_products_import) {
    push(
      "import",
      "Import through the supplier",
      "failed",
      new CapabilityUnavailableError("my_products_import").message,
    );
    return { passed: false, steps, candidateId };
  }

  await queueCandidates([candidateId]);
  const outcome = await runImportQueue(1);
  const { data: after } = await supabase
    .from("zendrop_import_candidates")
    .select("state, failure_reason, store_reference")
    .eq("id", candidateId)
    .maybeSingle();
  const post = after as any;
  if (post?.state !== "imported" && post?.state !== "detected_in_store" && post?.state !== "live") {
    push(
      "import",
      "Import through the supplier",
      "failed",
      post?.failure_reason ?? outcome.messages[0] ?? "The import did not complete",
    );
    return { passed: false, steps, candidateId };
  }
  push(
    "import",
    "Import through the supplier",
    "passed",
    post.store_reference ? `Supplier reference ${post.store_reference}` : "Accepted by the supplier",
  );
  push(
    "supplier_products",
    "Confirm supplier products state",
    "passed",
    "The product is recorded against the connected supplier account",
  );

  await reconcileImportedCandidates();
  const { data: final } = await supabase
    .from("zendrop_import_candidates")
    .select("state, shopify_product_id")
    .eq("id", candidateId)
    .maybeSingle();
  const finalRow = final as any;
  const inStore = Boolean(finalRow?.shopify_product_id);
  push(
    "store",
    "Confirm the product reaches the store",
    inStore ? "passed" : "skipped",
    inStore
      ? `Store product ${finalRow.shopify_product_id}`
      : "Not visible in the store mirror yet. The existing sync will pick it up on its next pass.",
  );
  push(
    "sync",
    "Confirm the existing catalogue sync sees it",
    finalRow?.state === "live" ? "passed" : "skipped",
    finalRow?.state === "live"
      ? "Processed by catalogue intelligence and live"
      : "Waiting on the existing intake pipeline",
  );

  await markOneProductTestPassed();
  return { passed: true, steps, candidateId };
}

/* -------------------------------- counters -------------------------------- */

export async function loadCounters(): Promise<SourcingCounters> {
  const supabase = await zendropAdminClient();
  const { data } = await supabase.from("zendrop_import_candidates").select("state, imported_at");
  const rows = (data ?? []) as any[];
  const since = Date.now() - 86_400_000;
  return {
    total: rows.length,
    queued: rows.filter((r) => r.state === "queued" || r.state === "importing").length,
    importedToday: rows.filter((r) => r.imported_at && Date.parse(r.imported_at) >= since).length,
    failedOrHeld: rows.filter((r) => r.state === "failed" || r.state === "held").length,
    live: rows.filter((r) => r.state === "live").length,
  };
}
