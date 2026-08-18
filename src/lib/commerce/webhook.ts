/**
 * Store order webhook helpers.
 *
 * Signature verification and payload normalisation are kept apart from the
 * route so both can be tested directly.
 */
import { createHmac, timingSafeEqual } from "crypto";

/** Constant time signature check over the exact raw body. */
export function verifyStoreSignature(body: string, signature: string, secret: string): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(body, "utf8").digest("base64");
  const provided = Buffer.from(signature);
  const digest = Buffer.from(expected);
  if (provided.length !== digest.length) return false;
  return timingSafeEqual(provided, digest);
}

export interface NormalisedOrder {
  shopifyOrderId: string;
  shopifyOrderName: string | null;
  shopifyOrderNumber: number | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  cancelledAt: string | null;
  currency: string | null;
  total: number | null;
  shippingCountry: string | null;
  shippingCity: string | null;
  lines: Array<{
    shopifyLineItemId: string;
    shopifyVariantId: string | null;
    shopifyProductId: string | null;
    sku: string | null;
    title: string | null;
    quantity: number;
    unitPrice: number | null;
  }>;
}

function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Reads only the fields NUR GOODS needs. No card data, no payment credential
 * and no customer contact detail is taken from the payload.
 */
export function normaliseOrderPayload(payload: any): NormalisedOrder | null {
  const id = payload?.admin_graphql_api_id ?? (payload?.id ? `gid://shopify/Order/${payload.id}` : null);
  if (typeof id !== "string" || !id.startsWith("gid://shopify/Order/")) return null;

  const lines = Array.isArray(payload?.line_items) ? payload.line_items : [];
  return {
    shopifyOrderId: id,
    shopifyOrderName: typeof payload?.name === "string" ? payload.name : null,
    shopifyOrderNumber: numberOrNull(payload?.order_number),
    financialStatus: typeof payload?.financial_status === "string" ? payload.financial_status : null,
    fulfillmentStatus: typeof payload?.fulfillment_status === "string" ? payload.fulfillment_status : null,
    cancelledAt: typeof payload?.cancelled_at === "string" ? payload.cancelled_at : null,
    currency: typeof payload?.currency === "string" ? payload.currency : null,
    total: numberOrNull(payload?.total_price),
    shippingCountry:
      typeof payload?.shipping_address?.country_code === "string" ? payload.shipping_address.country_code : null,
    shippingCity: typeof payload?.shipping_address?.city === "string" ? payload.shipping_address.city : null,
    lines: lines.map((line: any) => ({
      shopifyLineItemId: String(line?.admin_graphql_api_id ?? line?.id ?? ""),
      shopifyVariantId: line?.variant_id ? `gid://shopify/ProductVariant/${line.variant_id}` : null,
      shopifyProductId: line?.product_id ? `gid://shopify/Product/${line.product_id}` : null,
      sku: typeof line?.sku === "string" ? line.sku : null,
      title: typeof line?.title === "string" ? line.title : null,
      quantity: numberOrNull(line?.quantity) ?? 1,
      unitPrice: numberOrNull(line?.price),
    })),
  };
}
