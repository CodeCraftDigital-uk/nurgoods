/**
 * What the supplier actually tells us about stock, and what we are allowed to
 * conclude from it.
 *
 * This is deliberately conservative. The connected supplier plan does not
 * expose inventory: the catalogue product read carries no quantity and no
 * availability flag, the store product read carries variant identity only, and
 * the inventory operation is refused with a plan upgrade message. So no
 * quantity is ever invented here.
 *
 * The model therefore has three signal levels and each one has a different
 * safe conclusion:
 *
 *   quantity     - genuine per variant counts. Sync them.
 *   availability - a per variant or product level boolean. Enforce saleability
 *                  from it, but never write a made up quantity.
 *   none         - no stock signal at all. Saleability is governed only by the
 *                  freshness target, deliverability evidence and price safety,
 *                  and the store must be set to refuse oversell so a listing
 *                  can never sell more than the store itself is tracking.
 *
 * Pure functions only. No network access, so the conclusions are testable.
 */

export type SupplierStockSignal = "quantity" | "availability" | "none";

export interface SupplierVariantReading {
  /** Supplier side identifier, normally the supplier SKU. */
  sku: string | null;
  /** Store variant this supplier variant is mapped to, when known. */
  storeVariantId: string | null;
  title: string | null;
  available: boolean | null;
  quantity: number | null;
}

export interface SupplierStockReading {
  signal: SupplierStockSignal;
  productAvailable: boolean | null;
  variants: SupplierVariantReading[];
  /** Plain explanation of what the supplier did and did not provide. */
  note: string;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function booleanOrNull(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (["true", "in_stock", "instock", "available", "active"].includes(text)) return true;
    if (["false", "out_of_stock", "outofstock", "unavailable", "inactive"].includes(text)) {
      return false;
    }
  }
  return null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Reads whatever stock signal the supplier payloads carry.
 *
 * `catalogueProduct` is the supplier catalogue record and `storeVariants` is
 * the supplier's view of our imported product. Both are probed rather than
 * assumed, so if the supplier plan is upgraded and quantities start appearing
 * they are picked up without any further change.
 */
export function readSupplierStock(input: {
  catalogueProduct?: { inventory?: number | null; available?: unknown } | null;
  catalogueVariants?: Array<Record<string, unknown>> | null;
  storeVariants?: Array<Record<string, unknown>> | null;
}): SupplierStockReading {
  const catalogueVariants = input.catalogueVariants ?? [];
  const storeVariants = input.storeVariants ?? [];

  const bySku = new Map<string, SupplierVariantReading>();

  for (const raw of catalogueVariants) {
    const sku = text(raw["sku"]) ?? text(raw["supplier_sku"]) ?? text(raw["id"]);
    if (!sku) continue;
    bySku.set(sku, {
      sku,
      storeVariantId: null,
      title: text(raw["title"]) ?? text(raw["variant_title"]),
      available: booleanOrNull(raw["available"] ?? raw["in_stock"] ?? raw["availability"]),
      quantity: numberOrNull(raw["inventory"] ?? raw["stock"] ?? raw["quantity"]),
    });
  }

  for (const raw of storeVariants) {
    const sku = text(raw["variant_sku"]) ?? text(raw["sku"]);
    const storeVariantId = text(raw["store_variant_id"]) ?? text(raw["shopify_variant_id"]);
    const existing = sku ? bySku.get(sku) : undefined;
    const entry: SupplierVariantReading = {
      sku: sku ?? existing?.sku ?? null,
      storeVariantId,
      title: text(raw["variant_title"]) ?? existing?.title ?? null,
      available:
        booleanOrNull(raw["available"] ?? raw["in_stock"] ?? raw["availability"]) ??
        existing?.available ??
        null,
      quantity:
        numberOrNull(raw["inventory"] ?? raw["stock"] ?? raw["quantity"]) ??
        existing?.quantity ??
        null,
    };
    if (sku) bySku.set(sku, entry);
    else if (storeVariantId) bySku.set(storeVariantId, entry);
  }

  const variants = [...bySku.values()];
  const productQuantity = numberOrNull(input.catalogueProduct?.inventory ?? null);
  const productAvailable =
    booleanOrNull(input.catalogueProduct?.available ?? null) ??
    (productQuantity === null ? null : productQuantity > 0);

  const hasQuantity =
    variants.some((variant) => variant.quantity !== null) || productQuantity !== null;
  const hasAvailability =
    variants.some((variant) => variant.available !== null) || productAvailable !== null;

  const signal: SupplierStockSignal = hasQuantity
    ? "quantity"
    : hasAvailability
      ? "availability"
      : "none";

  const note =
    signal === "quantity"
      ? "The supplier reported stock quantities, so exact figures are synced."
      : signal === "availability"
        ? "The supplier reported availability without quantities, so saleability is enforced from availability and no quantity is invented."
        : "The connected supplier plan exposes no stock quantity and no availability flag, so saleability is governed by the freshness target, delivery evidence and price safety, and the store is set to refuse oversell.";

  return { signal, productAvailable, variants, note };
}

export interface SaleabilityVerdict {
  sellable: boolean;
  /** Variants the supplier positively reports as unsellable. */
  blockedVariantSkus: string[];
  reason: string;
}

/**
 * Turns a stock reading into a saleability verdict.
 *
 * A positive "out of stock" from the supplier always blocks. Absence of a
 * signal never fabricates one: it neither blocks nor clears, and the caller
 * falls back to the freshness and deliverability gates.
 */
export function saleabilityFromStock(
  reading: SupplierStockReading,
  options?: { requireStock?: boolean },
): SaleabilityVerdict {
  const requireStock = options?.requireStock !== false;

  if (reading.signal === "none") {
    return {
      sellable: true,
      blockedVariantSkus: [],
      reason: reading.note,
    };
  }

  const blocked = reading.variants
    .filter((variant) =>
      variant.quantity !== null ? variant.quantity <= 0 : variant.available === false,
    )
    .map((variant) => variant.sku ?? variant.storeVariantId ?? "unknown");

  const productBlocked =
    reading.productAvailable === false ||
    (reading.variants.length > 0 && blocked.length === reading.variants.length);

  if (requireStock && productBlocked) {
    return {
      sellable: false,
      blockedVariantSkus: blocked,
      reason: "The supplier reports no sellable stock for this product, so it cannot stay on sale.",
    };
  }

  if (requireStock && blocked.length > 0) {
    return {
      sellable: true,
      blockedVariantSkus: blocked,
      reason: `${blocked.length} variant(s) are out of stock at the supplier and were made unsellable. The remaining variants stay on sale.`,
    };
  }

  return {
    sellable: true,
    blockedVariantSkus: [],
    reason: "The supplier reports the product as available.",
  };
}
