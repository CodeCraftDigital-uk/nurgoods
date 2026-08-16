/**
 * Applies NUR GOODS retail pricing to a supplier product after it lands in the
 * store.
 *
 * The supplier import cannot carry a price, and a supplier product can hold
 * several variants with very different unit costs, so every variant is priced
 * from its own cost of goods plus the quoted shipping cost. A single flat
 * price across variants would sell the expensive variants at a loss, so that
 * is never done. When a variant has no cost recorded, it is left untouched and
 * reported rather than guessed.
 */
import { intakeCredentials, shopifyGraphql } from "../services/shopify.server";
import { applyRounding } from "./pricing";
import type { PricingSettings } from "./types";

const PRODUCT_COST_QUERY = `
  query NurGoodsVariantCosts($id: ID!) {
    product(id: $id) {
      variants(first: 100) {
        nodes {
          id
          title
          price
          inventoryItem { unitCost { amount currencyCode } }
        }
      }
    }
  }
`;

const VARIANT_PRICE_MUTATION = `
  mutation NurGoodsVariantPrices($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id price }
      userErrors { field message }
    }
  }
`;

export interface VariantPricing {
  variantId: string;
  title: string;
  unitCost: number | null;
  landedCost: number | null;
  price: number | null;
  previousPrice: string | null;
  skippedReason: string | null;
}

export interface StorePricingResult {
  applied: boolean;
  updated: number;
  variants: VariantPricing[];
  message: string;
}

export async function applyCalculatedPriceToStore(input: {
  shopifyProductId: string;
  shippingCost: number | null;
  settings: PricingSettings;
  fallbackPrice?: number | null;
}): Promise<StorePricingResult> {
  const { settings } = input;
  const margin = settings.target_margin;
  if (!(margin > 0 && margin < 1)) {
    return { applied: false, updated: 0, variants: [], message: "The target margin is invalid" };
  }

  const credentials = await intakeCredentials();
  const data: any = await shopifyGraphql(credentials, PRODUCT_COST_QUERY, {
    id: input.shopifyProductId,
  });
  const nodes: any[] = data?.product?.variants?.nodes ?? [];
  if (nodes.length === 0) {
    return { applied: false, updated: 0, variants: [], message: "The store product has no variants yet" };
  }

  const shipping = typeof input.shippingCost === "number" ? input.shippingCost : null;
  const rows: VariantPricing[] = nodes.map((node) => {
    const rawCost = node?.inventoryItem?.unitCost?.amount;
    const unitCost = rawCost === null || rawCost === undefined ? null : Number(rawCost);
    const usableCost = typeof unitCost === "number" && Number.isFinite(unitCost) ? unitCost : null;
    if (usableCost === null || shipping === null) {
      const fallback =
        nodes.length === 1 && typeof input.fallbackPrice === "number" ? input.fallbackPrice : null;
      return {
        variantId: String(node.id),
        title: String(node.title ?? ""),
        unitCost: usableCost,
        landedCost: null,
        price: fallback,
        previousPrice: node?.price ?? null,
        skippedReason: fallback === null ? "No cost of goods is recorded for this variant" : null,
      };
    }
    const landedCost = Math.round((usableCost + shipping) * 100) / 100;
    const price = applyRounding(landedCost / (1 - margin), settings.rounding_mode);
    return {
      variantId: String(node.id),
      title: String(node.title ?? ""),
      unitCost: usableCost,
      landedCost,
      price,
      previousPrice: node?.price ?? null,
      skippedReason: null,
    };
  });

  const changes = rows
    .filter((row) => row.price !== null && row.previousPrice !== row.price!.toFixed(2))
    .map((row) => ({ id: row.variantId, price: row.price!.toFixed(2) }));

  if (changes.length === 0) {
    const blocked = rows.filter((row) => row.skippedReason).length;
    return {
      applied: blocked === 0,
      updated: 0,
      variants: rows,
      message: blocked === 0 ? "Every variant price already matches" : `${blocked} variant(s) had no cost data`,
    };
  }

  const result: any = await shopifyGraphql(credentials, VARIANT_PRICE_MUTATION, {
    productId: input.shopifyProductId,
    variants: changes,
  });
  const errors = result?.productVariantsBulkUpdate?.userErrors ?? [];
  if (errors.length > 0) {
    return {
      applied: false,
      updated: 0,
      variants: rows,
      message: errors.map((error: any) => error.message).join(" "),
    };
  }
  const skipped = rows.filter((row) => row.skippedReason).length;
  return {
    applied: true,
    updated: changes.length,
    variants: rows,
    message: `Priced ${changes.length} variant(s) at a ${(margin * 100).toFixed(0)}% target margin${
      skipped > 0 ? `, ${skipped} left unchanged with no cost data` : ""
    }`,
  };
}
