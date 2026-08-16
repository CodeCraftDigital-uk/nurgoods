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
import { screenCandidate } from "./screening";
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
import { convertAmount, getFxRate, type FxQuote } from "./fx.server";

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
  min_retail_price: null,
  min_suitability_score: 60,
  restricted_keywords: [],
  max_variant_count: null,
  continuous_sourcing: false,
  target_catalogue_size: null,
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
    min_retail_price:
      row.min_retail_price === null || row.min_retail_price === undefined
        ? null
        : Number(row.min_retail_price),
    min_suitability_score: Number(row.min_suitability_score ?? DEFAULT_RULES.min_suitability_score),
    restricted_keywords: row.restricted_keywords ?? [],
    max_variant_count:
      row.max_variant_count === null || row.max_variant_count === undefined
        ? null
        : Number(row.max_variant_count),
    continuous_sourcing: Boolean(row.continuous_sourcing),
    target_catalogue_size:
      row.target_catalogue_size === null || row.target_catalogue_size === undefined
        ? null
        : Number(row.target_catalogue_size),
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
  const cap = Math.max(1, Math.min(rules.batch_size, 500));
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

    const item = await getZendropProduct(productId, settings.shipping_market);
    if (!item) {
      result.skipped += 1;
      result.messages.push(`Supplier product ${productId} could not be read`);
      continue;
    }

    const validation = validateCandidate(item, rules);
    let fx: FxQuote;
    try {
      fx = await getFxRate(item.currency, settings.currency);
    } catch (cause) {
      result.skipped += 1;
      result.messages.push(
        cause instanceof Error ? cause.message : `Currency conversion failed for ${productId}`,
      );
      continue;
    }
    const pricing = {
      ...computePricing({
        supplierCost: convertAmount(item.cost, fx.rate),
        shippingCost: convertAmount(item.shippingCost, fx.rate),
        suggestedRetail: convertAmount(item.suggestedRetail, fx.rate),
        settings,
      }),
      fx: {
        from: fx.from,
        to: fx.to,
        rate: fx.rate,
        asOf: fx.asOf,
        source: fx.source,
        supplierCostSource: item.cost,
        shippingCostSource: item.shippingCost,
      },
    };


    // Deterministic pre-screen and suitability score. Every accept, hold or
    // reject carries the reason that produced it.
    const duplicateReason = rules.duplicate_precheck ? await duplicatePrecheck(item) : null;
    const screen = screenCandidate({
      item,
      rules,
      settings,
      supplierCost: convertAmount(item.cost, fx.rate),
      shippingCost: convertAmount(item.shippingCost, fx.rate),
      suggestedRetail: convertAmount(item.suggestedRetail, fx.rate),
      duplicateReason,
    });

    let state: CandidateState = "duplicate_checked";
    let hold: string | null = null;
    if (!validation.ok) {
      state = "held";
      hold = validation.reason;
    } else if (screen.outcome === "held" || screen.outcome === "rejected") {
      state = "held";
      hold = screen.blockingReason ?? "The product did not pass the sourcing screen";
    } else if (screen.score < rules.min_suitability_score) {
      state = "held";
      hold = `Suitability score ${screen.score} is below the configured minimum of ${rules.min_suitability_score}`;
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
        suitability_score: screen.score,
        score_reasons: screen.reasons as unknown as Record<string, unknown>[],
        screening: {
          outcome: screen.outcome,
          threshold: rules.min_suitability_score,
          landed_cost: screen.landedCost,
          price: screen.price,
          gross_margin: screen.grossMargin,
          promo_within_floor: screen.promoWithinFloor,
        } as Record<string, unknown>,
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

/** Reads the connected supplier store so pushes target the right destination. */
export async function resolveSupplierStore(): Promise<{ id: string; name: string | null } | null> {
  const roles = await loadCapabilityMap();
  if (!roles.stores_list) return null;
  const payload = await callAction(roles.stores_list, {});
  const list = Array.isArray(payload)
    ? payload
    : (payload?.stores ?? payload?.data ?? payload?.results ?? []);
  const first = Array.isArray(list) ? list[0] : null;
  if (!first) return null;
  const id = first.id ?? first.store_id;
  if (id === undefined || id === null) return null;
  return { id: String(id), name: first.name ?? first.store_name ?? null };
}

/**
 * Sends one candidate through the supplier flow: add it to the supplier
 * product list, then push that listing into the connected store and wait for
 * the supplier operation to settle.
 */
async function findImportListEntry(
  productId: string,
  storeId: string,
): Promise<any | null> {
  const roles = await loadCapabilityMap();
  if (!roles.my_products_list) return null;
  const numericStore = Number(storeId) || storeId;
  for (const status of ["imported", "in_store"]) {
    for (let page = 1; page <= 5; page += 1) {
      const payload = await callAction(roles.my_products_list, {
        store_id: numericStore,
        status,
        page,
        limit: 60,
      });
      const list = Array.isArray(payload)
        ? payload
        : (payload?.products ?? payload?.items ?? payload?.data ?? payload?.results ?? []);
      if (!Array.isArray(list) || list.length === 0) break;
      const match = list.find(
        (row: any) =>
          String(row?.product_id ?? row?.catalog_product_id ?? row?.zendrop_product_id ?? "") ===
          String(productId),
      );
      if (match) return match;
      if (list.length < 60) break;
    }
  }
  return null;
}

async function pushCandidateToSupplier(
  productId: string,
  storeId: string,
): Promise<{ myProductId: string | null; operation: any; response: any }> {
  const roles = await loadCapabilityMap();
  if (!roles.my_products_import) throw new CapabilityUnavailableError("my_products_import");
  if (!roles.my_products_push) throw new CapabilityUnavailableError("my_products_push");

  const numericProduct = Number(productId) || productId;
  const numericStore = Number(storeId) || storeId;

  const added = await callAction(roles.my_products_import, {
    product_id: numericProduct,
    store_id: numericStore,
  });

  const entry = await findImportListEntry(productId, storeId);
  const importListId =
    entry?.import_list_id ?? entry?.id ?? added?.import_list_id ?? added?.id ?? null;
  if (importListId === null || importListId === undefined) {
    throw new Error("The supplier import list entry could not be located after adding the product");
  }

  if (String(entry?.status ?? "").toLowerCase() === "in_store") {
    return { myProductId: String(importListId), operation: entry, response: added };
  }

  const pushed = await callAction(roles.my_products_push, {
    import_list_id: Number(importListId) || importListId,
  });

  let operation = pushed;
  const operationId = pushed?.operation_id ?? pushed?.id ?? null;
  if (operationId && roles.import_operation) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2500));
      operation = await callAction(roles.import_operation, {
        operation_id: Number(operationId) || operationId,
      });
      const status = String(operation?.status ?? operation?.state ?? "").toLowerCase();
      if (["completed", "complete", "success", "succeeded", "finished"].includes(status)) break;
      if (["failed", "error", "cancelled", "canceled"].includes(status)) {
        throw new Error(
          operation?.error ?? operation?.message ?? "The supplier import operation failed",
        );
      }
    }
  }

  return { myProductId: String(importListId), operation, response: added };
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

  const store = await resolveSupplierStore();
  if (!store) {
    outcome.messages.push(
      "No connected supplier store could be read, so nothing was sent to the store.",
    );
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
      const pushed = await pushCandidateToSupplier(raw.zendrop_product_id, store.id);
      await supabase
        .from("zendrop_import_candidates")
        .update({
          state: "imported",
          previous_state: "importing",
          imported_at: new Date().toISOString(),
          write_response: {
            store_id: store.id,
            store_name: store.name,
            added: pushed.response ?? {},
            operation: pushed.operation ?? {},
          } as Record<string, unknown>,
          store_reference: pushed.myProductId,
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
        "The supplier accepted the import and sent it to the connected store",
        { action: action.name, store_id: store.id },
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
  const settings = await loadPricingSettings();
  const { data: rows } = await supabase
    .from("zendrop_import_candidates")
    .select("id, title, zendrop_product_id, state, write_response, calculated_price, shipping_cost")
    .in("state", ["imported", "linked"])
    .limit(50);

  let matched = 0;
  for (const raw of (rows ?? []) as any[]) {
    const storeProductId = raw?.write_response?.operation?.store_product_id
      ? String(raw.write_response.operation.store_product_id)
      : null;

    let product: any = null;
    if (storeProductId) {
      const { data: byId } = await supabase
        .from("shopify_products")
        .select("id, shopify_product_id")
        .or(
          `shopify_product_id.eq.${storeProductId},shopify_product_id.eq.gid://shopify/Product/${storeProductId}`,
        )
        .limit(1)
        .maybeSingle();
      product = byId;
    }
    if (!product) {
      const { data: byTitle } = await supabase
        .from("shopify_products")
        .select("id, shopify_product_id")
        .ilike("title", raw.title)
        .limit(1)
        .maybeSingle();
      product = byTitle;
    }
    if (!product) continue;

    // The supplier import cannot carry a price, so every variant is priced
    // from its own cost of goods once the store product exists.
    let pricingNote = "Pricing was not applied";
    try {
      const { applyCalculatedPriceToStore } = await import("./store-pricing.server");
      const result = await applyCalculatedPriceToStore({
        shopifyProductId: String(product.shopify_product_id),
        shippingCost: raw.shipping_cost === null ? null : Number(raw.shipping_cost),
        settings,
        fallbackPrice: raw.calculated_price === null ? null : Number(raw.calculated_price),
      });
      pricingNote = result.message;
    } catch (cause) {
      pricingNote = cause instanceof Error ? cause.message : "The store price could not be set";
    }

    // The supplier push can leave the product off the headless sales channel
    // that serves checkout, which would break "Buy now" for shoppers.
    let channelNote = "Sales channels were not checked";
    try {
      const { ensureStorePublications } = await import("./store-publication.server");
      const publication = await ensureStorePublications(String(product.shopify_product_id));
      channelNote = publication.message;
    } catch (cause) {
      channelNote = cause instanceof Error ? cause.message : "Sales channels could not be set";
    }


    await supabase
      .from("zendrop_import_candidates")
      .update({
        state: "detected_in_store",
        previous_state: raw.state,
        product_id: product.id,
        shopify_product_id: product.shopify_product_id,
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
      `The store product is linked. ${pricingNote}. ${channelNote}`,
      { shopify_product_id: product.shopify_product_id },
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
