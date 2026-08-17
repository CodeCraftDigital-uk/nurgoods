/**
 * Safe pricing audit for listings that already exist in the catalogue.
 *
 * The audit is a dry run. It classifies every active variant against the
 * configured pricing formula and records the exact inputs it used, including
 * where each cost input came from. A variant is only ever marked ready to
 * reprice when both a real cost of goods and a real UK shipping figure are
 * available, so no price is ever derived from an invented number.
 *
 *   landed cost = supplier cost of goods + UK shipping attributable to it
 *   base price  = landed cost / (1 - target gross margin), then rounded
 */
import { applyRounding } from "../zendrop/pricing";
import { zendropAdminClient } from "../zendrop/client.server";
import { loadPricingSettings } from "../zendrop/import.server";
import type { AuditStatus, AuditTotals } from "./types";
import { AUDIT_STATUSES } from "./types";

const PENCE = 0.005;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function margin(price: number | null, landed: number | null): number | null {
  if (price === null || landed === null || price <= 0) return null;
  return round2((price - landed) / price * 10000) / 10000;
}

export interface ShippingBasis {
  cost: number | null;
  source: string | null;
  linked: boolean;
}

/**
 * Shipping can only come from a genuine supplier quote captured at import
 * time. Listings that predate the supplier integration carry no such record,
 * so they are reported as unlinked rather than given a stand-in figure.
 */
export async function loadShippingBasis(): Promise<Map<string, ShippingBasis>> {
  const supabase = await zendropAdminClient();
  const basis = new Map<string, ShippingBasis>();

  const record = (raw: any, source: string) => {
    const cost = raw.shipping_cost === null ? null : Number(raw.shipping_cost);
    const entry: ShippingBasis = {
      cost: Number.isFinite(cost as number) ? (cost as number) : null,
      source: cost === null ? null : (raw.shipping_source ?? source),
      linked: true,
    };
    if (raw.shopify_product_id) basis.set(String(raw.shopify_product_id), entry);
    if (raw.product_id) basis.set(`uuid:${raw.product_id}`, entry);
  };

  const { data: candidates } = await supabase
    .from("zendrop_import_candidates")
    .select("product_id, shopify_product_id, shipping_cost, currency, updated_at")
    .not("shopify_product_id", "is", null)
    .order("updated_at", { ascending: true });
  for (const raw of (candidates ?? []) as any[]) record(raw, "supplier_shipping_quote");

  // Recovered links carry first party supplier evidence, so they take priority.
  const { data: links } = await supabase
    .from("product_supplier_links")
    .select("product_id, shopify_product_id, shipping_cost, shipping_source, match_confidence")
    .eq("match_confidence", "high")
    .order("verified_at", { ascending: true });
  for (const raw of (links ?? []) as any[]) record(raw, "supplier_shipping_quote");

  return basis;
}

async function loadSuppressedProductIds(): Promise<Set<string>> {
  const supabase = await zendropAdminClient();
  const { data } = await supabase
    .from("duplicate_group_members")
    .select("product_id")
    .eq("suppressed", true);
  return new Set(((data ?? []) as any[]).map((row) => String(row.product_id)));
}

export interface AuditRunSummary {
  runId: string;
  totals: AuditTotals;
  message: string;
}

export async function runPricingAudit(userId: string | null): Promise<AuditRunSummary> {
  const supabase = await zendropAdminClient();
  const settings = await loadPricingSettings();
  const [shipping, suppressed] = await Promise.all([
    loadShippingBasis(),
    loadSuppressedProductIds(),
  ]);

  const { data: runRow, error: runError } = await supabase
    .from("pricing_audit_runs")
    .insert({
      mode: "preview",
      status: "running",
      settings: settings as unknown as Record<string, unknown>,
      created_by: userId,
    } as never)
    .select("id")
    .maybeSingle();
  if (runError || !runRow) throw new Error("The pricing audit run could not be started");
  const runId = (runRow as any).id as string;

  const { data: products } = await supabase
    .from("shopify_products")
    .select("id, shopify_product_id, handle, title, status, currency")
    .order("title", { ascending: true });

  const totals = Object.fromEntries(AUDIT_STATUSES.map((s) => [s, 0])) as AuditTotals;
  totals.variants = 0;
  totals.products = 0;
  totals.productsReprisable = 0;
  totals.productsHeld = 0;

  const rows: Record<string, unknown>[] = [];

  for (const product of ((products ?? []) as any[])) {
    totals.products += 1;
    const productKey = String(product.shopify_product_id);
    const basis =
      shipping.get(productKey) ??
      shipping.get(`uuid:${product.id}`) ??
      ({ cost: null, source: null, linked: false } as ShippingBasis);

    const { data: variants } = await supabase
      .from("shopify_product_variants")
      .select("shopify_variant_id, title, price, currency, unit_cost, unit_cost_currency, cost_source")
      .eq("product_id", product.id)
      .order("position", { ascending: true });

    const excluded =
      suppressed.has(String(product.id)) ||
      String(product.status ?? "").toUpperCase() === "ARCHIVED" ||
      String(product.status ?? "").toUpperCase() === "DRAFT";

    let productHasReady = false;

    for (const variant of ((variants ?? []) as any[])) {
      totals.variants += 1;
      const currentPrice = variant.price === null ? null : Number(variant.price);
      const unitCost = variant.unit_cost === null ? null : Number(variant.unit_cost);
      const costCurrency = variant.unit_cost_currency ?? null;

      let status: AuditStatus;
      let reason: string | null = null;
      let landed: number | null = null;
      let calculated: number | null = null;

      if (excluded) {
        status = "excluded_by_policy";
        reason = suppressed.has(String(product.id))
          ? "This listing is a suppressed duplicate, so its price is not customer facing"
          : "The listing is not active in the store";
      } else if (!basis.linked) {
        status = "held_unreliable_linkage";
        reason =
          "No supplier cost linkage record exists for this listing, so the landed cost basis cannot be confirmed. It predates the supplier integration.";
      } else if (unitCost === null) {
        status = "held_missing_cost";
        reason = "No cost of goods is recorded against this variant in the store";
      } else if (costCurrency && costCurrency !== settings.currency) {
        status = "held_unreliable_linkage";
        reason = `The recorded cost is in ${costCurrency} but pricing runs in ${settings.currency}, so the basis is not comparable`;
      } else if (basis.cost === null) {
        status = "held_missing_uk_shipping";
        reason = `No confirmed shipping cost to ${settings.shipping_market} is recorded for this listing`;
      } else if (!(settings.target_margin > 0 && settings.target_margin < 1)) {
        status = "held_unreliable_linkage";
        reason = "The configured target gross margin is invalid";
      } else {
        landed = round2(unitCost + basis.cost);
        calculated = applyRounding(landed / (1 - settings.target_margin), settings.rounding_mode);
        if (currentPrice !== null && Math.abs(currentPrice - calculated) < PENCE) {
          status = "already_correct";
          reason = "The live price already matches the formula";
        } else {
          status = "ready_to_reprice";
          productHasReady = true;
        }
      }

      totals[status] += 1;
      rows.push({
        run_id: runId,
        product_id: product.id,
        shopify_product_id: productKey,
        handle: product.handle,
        product_title: product.title,
        shopify_variant_id: String(variant.shopify_variant_id),
        variant_title: variant.title,
        currency: settings.currency,
        current_price: currentPrice,
        unit_cost: unitCost,
        cost_source: variant.cost_source,
        shipping_cost: basis.cost,
        shipping_source: basis.source,
        landed_cost: landed,
        calculated_price: calculated,
        current_margin: margin(currentPrice, landed),
        proposed_margin: margin(calculated, landed),
        status,
        reason,
      });
    }

    if (productHasReady) totals.productsReprisable += 1;
    else if (!excluded) totals.productsHeld += 1;
  }

  for (let index = 0; index < rows.length; index += 400) {
    await supabase.from("pricing_audit_items").insert(rows.slice(index, index + 400) as never);
  }

  const message = `${totals.ready_to_reprice} variant(s) ready to reprice, ${
    totals.already_correct
  } already correct, ${
    totals.held_missing_cost + totals.held_missing_uk_shipping + totals.held_unreliable_linkage
  } held, ${totals.excluded_by_policy} excluded.`;

  await supabase
    .from("pricing_audit_runs")
    .update({
      status: "completed",
      totals: totals as unknown as Record<string, unknown>,
      message,
      completed_at: new Date().toISOString(),
    } as never)
    .eq("id", runId);

  return { runId, totals, message };
}
