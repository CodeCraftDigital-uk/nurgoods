/**
 * Supplier linkage recovery for listings that predate the sourcing module.
 *
 * Older listings carry no sourcing record, so the pricing audit had to hold
 * them for an unconfirmed landed cost basis. The supplier account itself still
 * knows which of its products were pushed into the store, and it reports the
 * exact store product id and store variant ids for each one. That mapping is
 * first party evidence, not a guess, so it is used to rebuild the link and to
 * attach a genuine UK shipping quote to each listing.
 *
 * Nothing here infers a link from similarity alone. A listing is only marked
 * reliable when the supplier itself reports the store product id.
 */
import { callAction, zendropAdminClient } from "../zendrop/client.server";
import type { DiscoveredAction } from "../zendrop/client.server";
import { getFxRate } from "../zendrop/fx.server";
import { loadPricingSettings, resolveSupplierStore } from "../zendrop/import.server";

function action(name: string, kind: "read" | "write" = "read"): DiscoveredAction {
  return { name, description: "", inputSchema: {}, kind };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

async function resolveStoreId(): Promise<number | null> {
  const store = await resolveSupplierStore();
  const id = Number(store?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

interface SupplierProduct {
  importListId: number;
  supplierProductId: number;
  name: string;
  storeProductId: string | null;
  status: string;
}

async function listSupplierProducts(storeId: number): Promise<SupplierProduct[]> {
  const items: SupplierProduct[] = [];
  let total = Infinity;
  for (let page = 1; page <= 40 && items.length < total; page += 1) {
    const payload = await callAction(action("get_my_products"), {
      store_id: storeId,
      page,
      limit: 50,
    });
    total = Number(payload?.total ?? 0) || items.length;
    const batch = (payload?.items ?? []) as any[];
    if (batch.length === 0) break;
    for (const raw of batch) {
      items.push({
        importListId: Number(raw.import_list_id),
        supplierProductId: Number(raw.product_id),
        name: String(raw.product_name ?? ""),
        storeProductId: raw.store_product_id ? String(raw.store_product_id) : null,
        status: String(raw.import_status ?? ""),
      });
    }
  }
  return items;
}

/** Cheapest genuine shipping option quoted by the supplier for the market. */
async function quoteShipping(
  supplierProductId: number,
  countryCode: string,
): Promise<{ amount: number; currency: string; option: string } | null> {
  const payload = await callAction(action("get_catalog_shipping_estimate"), {
    product_id: supplierProductId,
    country_code: countryCode.toLowerCase(),
  }).catch(() => null);
  const options = (payload?.shipping_options ?? payload?.options ?? []) as any[];
  let best: { amount: number; currency: string; option: string } | null = null;
  for (const option of Array.isArray(options) ? options : []) {
    const amount = Number(option?.price ?? option?.amount ?? option?.cost);
    if (!Number.isFinite(amount)) continue;
    const candidate = {
      amount,
      currency: String(option?.currency ?? payload?.currency ?? "USD").toUpperCase(),
      option: String(option?.type ?? option?.name ?? "regular"),
    };
    if (!best || candidate.amount < best.amount) best = candidate;
  }
  return best;
}

export interface LinkageRecoveryResult {
  supplierProducts: number;
  storeReported: number;
  linkedProducts: number;
  shippingQuoted: number;
  unmatchedSupplierProducts: number;
  withoutShippingQuote: number;
  message: string;
}

/**
 * Rebuilds the supplier link and UK shipping basis for existing listings.
 * Safe to re-run: every row is upserted on the store product id.
 */
export async function recoverSupplierLinkage(): Promise<LinkageRecoveryResult> {
  const supabase = await zendropAdminClient();
  const settings = await loadPricingSettings();
  const storeId = await resolveStoreId();
  if (!storeId) {
    throw new Error("No connected supplier store could be resolved, so linkage cannot be rebuilt");
  }

  const supplierProducts = await listSupplierProducts(storeId);
  const { data: mirrored } = await supabase
    .from("shopify_products")
    .select("id, shopify_product_id, title");
  // The mirror stores the store's global id form while the supplier reports
  // the numeric id, so both forms are indexed.
  const byShopifyId = new Map<string, any>();
  for (const row of ((mirrored ?? []) as any[])) {
    const gid = String(row.shopify_product_id);
    byShopifyId.set(gid, row);
    const numeric = gid.split("/").pop();
    if (numeric) byShopifyId.set(numeric, row);
  }

  const fx = await getFxRate("USD", settings.currency);

  let linked = 0;
  let quoted = 0;
  let unmatched = 0;
  let withoutQuote = 0;
  const storeReported = supplierProducts.filter((item) => item.storeProductId).length;

  for (const item of supplierProducts) {
    if (!item.storeProductId) {
      unmatched += 1;
      continue;
    }
    const product = byShopifyId.get(item.storeProductId);
    if (!product) {
      unmatched += 1;
      continue;
    }

    const detail = await callAction(action("get_my_product"), {
      import_list_id: item.importListId,
    }).catch(() => null);
    const variantMap = ((detail?.variants ?? []) as any[]).map((variant) => ({
      store_variant_id: variant?.store_variant_id ? String(variant.store_variant_id) : null,
      sku: variant?.variant_sku ? String(variant.variant_sku) : null,
      title: variant?.variant_title ? String(variant.variant_title) : null,
    }));

    const shipping = await quoteShipping(item.supplierProductId, settings.shipping_market);
    let shippingCost: number | null = null;
    if (shipping) {
      const rate = shipping.currency === settings.currency ? 1 : fx.rate;
      shippingCost = round2(shipping.amount * rate);
      quoted += 1;
    } else {
      withoutQuote += 1;
    }

    await supabase.from("product_supplier_links").upsert(
      {
        product_id: product.id,
        shopify_product_id: String(product.shopify_product_id),
        supplier: "zendrop",
        supplier_product_id: String(item.supplierProductId),
        supplier_import_list_id: String(item.importListId),
        shipping_cost: shippingCost,
        shipping_currency: settings.currency,
        shipping_source: shipping
          ? `supplier_shipping_quote_${settings.shipping_market.toLowerCase()}`
          : null,
        quoted_amount: shipping?.amount ?? null,
        quoted_currency: shipping?.currency ?? null,
        fx_rate: shipping && shipping.currency !== settings.currency ? fx.rate : 1,
        fx_as_of: shipping ? fx.asOf : null,
        match_method: "supplier_reported_store_product_id",
        match_confidence: "high",
        evidence: {
          supplier_product_name: item.name,
          import_status: item.status,
          shipping_option: shipping?.option ?? null,
          fx_source: fx.source,
        },
        variant_map: variantMap,
        verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "shopify_product_id" } as never,
    );
    linked += 1;
  }

  return {
    supplierProducts: supplierProducts.length,
    storeReported,
    linkedProducts: linked,
    shippingQuoted: quoted,
    unmatchedSupplierProducts: unmatched,
    withoutShippingQuote: withoutQuote,
    message: `${linked} listing(s) linked to the supplier with first party evidence, ${quoted} carrying a confirmed ${settings.shipping_market} shipping quote.`,
  };
}
