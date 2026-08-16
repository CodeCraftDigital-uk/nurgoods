/**
 * Supplier catalogue reads.
 *
 * The supplier response shape is normalised defensively: field names are
 * probed rather than assumed, and anything missing stays null so pricing can
 * report itself as incomplete instead of inventing numbers.
 */
import { callAction, loadCapabilityMap } from "./client.server";
import type { CatalogueItem, CatalogueSearchResult, CatalogueVariant } from "./types";

function pickNumber(source: any, keys: string[]): number | null {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      return Number(value);
    }
    if (value && typeof value === "object") {
      const nested = pickNumber(value, ["amount", "value", "price", "cost"]);
      if (nested !== null) return nested;
    }
  }
  return null;
}

function pickString(source: any, keys: string[]): string | null {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function pickImage(source: any): string | null {
  const direct = pickString(source, ["image", "image_url", "imageUrl", "thumbnail", "main_image"]);
  if (direct) return direct;
  const images = source?.images ?? source?.media ?? source?.photos;
  if (Array.isArray(images) && images.length > 0) {
    const first = images[0];
    if (typeof first === "string") return first;
    return pickString(first, ["url", "src", "image_url"]);
  }
  return null;
}

function normaliseVariant(raw: any): CatalogueVariant {
  return {
    id: String(raw?.id ?? raw?.variant_id ?? raw?.sku ?? ""),
    title: pickString(raw, ["title", "name", "option", "variant_title"]) ?? "Default",
    sku: pickString(raw, ["sku", "supplier_sku"]),
    cost: pickNumber(raw, ["cost", "product_cost", "price", "unit_cost", "supplier_cost"]),
    shippingCost: pickNumber(raw, ["shipping_cost", "shippingCost", "shipping", "shipping_price"]),
    suggestedRetail: pickNumber(raw, [
      "suggested_retail_price",
      "suggested_price",
      "msrp",
      "recommended_price",
      "compare_at_price",
    ]),
    inventory: pickNumber(raw, ["inventory", "stock", "quantity", "inventory_quantity"]),
  };
}

export function normaliseCatalogueItem(raw: any): CatalogueItem {
  const variantsRaw = Array.isArray(raw?.variants)
    ? raw.variants
    : Array.isArray(raw?.product_variants)
      ? raw.product_variants
      : [];
  const variants = variantsRaw.map(normaliseVariant).filter((v: CatalogueVariant) => v.id);
  const cheapest = variants.reduce<CatalogueVariant | null>((best, variant) => {
    if (variant.cost === null) return best;
    if (!best || (best.cost ?? Infinity) > variant.cost) return variant;
    return best;
  }, null);

  return {
    id: String(raw?.id ?? raw?.product_id ?? raw?.zendrop_id ?? ""),
    title: pickString(raw, ["title", "name", "product_name"]) ?? "Untitled supplier product",
    imageUrl: pickImage(raw),
    category: pickString(raw, ["category", "category_name", "product_type", "niche"]),
    cost: pickNumber(raw, ["cost", "product_cost", "price", "supplier_cost"]) ?? cheapest?.cost ?? null,
    shippingCost:
      pickNumber(raw, ["shipping_cost", "shippingCost", "shipping_price"]) ??
      cheapest?.shippingCost ??
      null,
    suggestedRetail:
      pickNumber(raw, ["suggested_retail_price", "suggested_price", "msrp", "recommended_price"]) ??
      cheapest?.suggestedRetail ??
      null,
    inventory: pickNumber(raw, ["inventory", "stock", "quantity"]) ?? cheapest?.inventory ?? null,
    shipsFrom: pickString(raw, ["ships_from", "shipping_from", "warehouse", "origin_country"]),
    deliveryEstimate: pickString(raw, [
      "delivery_time",
      "shipping_time",
      "estimated_delivery",
      "processing_time",
    ]),
    currency: pickString(raw, ["currency", "currency_code"]) ?? "USD",
    variants,
  };
}

function extractList(payload: any): { items: any[]; cursor: string | null; total: number | null } {
  if (Array.isArray(payload)) return { items: payload, cursor: null, total: payload.length };
  const items =
    payload?.products ?? payload?.items ?? payload?.data ?? payload?.results ?? payload?.catalog ?? [];
  const cursor =
    payload?.next_cursor ?? payload?.nextCursor ?? payload?.cursor ?? payload?.next_page ?? null;
  const total = typeof payload?.total === "number" ? payload.total : null;
  return {
    items: Array.isArray(items) ? items : [],
    cursor: cursor ? String(cursor) : null,
    total,
  };
}

export async function searchZendropCatalogue(input: {
  query?: string | undefined;
  category?: string | undefined;
  page?: number | undefined;
  cursor?: string | null | undefined;
  limit?: number | undefined;
}): Promise<CatalogueSearchResult> {
  const roles = await loadCapabilityMap();
  const action = roles.catalogue_search;
  const page = Math.max(1, input.page ?? 1);
  const limit = Math.min(50, Math.max(6, input.limit ?? 24));

  if (!action) {
    return {
      items: [],
      nextCursor: null,
      page,
      total: null,
      available: false,
      message:
        "The connected supplier account has not exposed a catalogue browse operation. Run a connection test once the token is stored.",
    };
  }

  const args: Record<string, unknown> = { limit, page };
  if (input.query?.trim()) args["query"] = input.query.trim();
  if (input.category?.trim()) args["category"] = input.category.trim();
  if (input.cursor) args["cursor"] = input.cursor;

  const payload = await callAction(action, args);
  const { items, cursor, total } = extractList(payload);
  return {
    items: items.map(normaliseCatalogueItem).filter((item) => item.id),
    nextCursor: cursor,
    page,
    total,
    available: true,
    message: null,
  };
}

export async function getZendropProduct(productId: string): Promise<CatalogueItem | null> {
  const roles = await loadCapabilityMap();
  const action = roles.catalogue_product ?? roles.catalogue_search;
  if (!action) return null;
  const payload = await callAction(action, { product_id: productId, id: productId });
  if (!payload) return null;
  if (Array.isArray(payload)) {
    const match = payload.find((row: any) => String(row?.id ?? row?.product_id) === productId);
    return match ? normaliseCatalogueItem(match) : null;
  }
  const single = payload?.product ?? payload?.data ?? payload;
  const item = normaliseCatalogueItem(single);
  return item.id ? item : null;
}
