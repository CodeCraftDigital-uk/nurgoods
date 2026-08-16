/**
 * Applies the NUR GOODS calculated retail price to a supplier product after it
 * lands in the store.
 *
 * The supplier import flow cannot carry a price, so the price is set here from
 * the same deterministic pricing snapshot the candidate was approved with.
 * Nothing else about the store product is changed.
 */
import { fetchShopifyProductById, intakeCredentials, shopifyGraphql } from "../services/shopify.server";

const VARIANT_PRICE_MUTATION = `
  mutation NurGoodsVariantPrices($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id price }
      userErrors { field message }
    }
  }
`;

export interface StorePricingResult {
  applied: boolean;
  updated: number;
  price: number | null;
  message: string;
}

export async function applyCalculatedPriceToStore(input: {
  shopifyProductId: string;
  price: number | null;
}): Promise<StorePricingResult> {
  const price = input.price;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    return { applied: false, updated: 0, price: null, message: "No calculated price was available" };
  }

  const product = await fetchShopifyProductById(input.shopifyProductId);
  const variants = (product as any)?.variants?.nodes ?? [];
  if (!Array.isArray(variants) || variants.length === 0) {
    return { applied: false, updated: 0, price, message: "The store product has no variants yet" };
  }

  const target = price.toFixed(2);
  const changes = variants
    .filter((variant: any) => String(variant?.price ?? "") !== target)
    .map((variant: any) => ({ id: variant.id, price: target }));
  if (changes.length === 0) {
    return { applied: true, updated: 0, price, message: "The store price already matches" };
  }

  const credentials = await intakeCredentials();
  const data: any = await shopifyGraphql(credentials, VARIANT_PRICE_MUTATION, {
    productId: input.shopifyProductId,
    variants: changes,
  });
  const errors = data?.productVariantsBulkUpdate?.userErrors ?? [];
  if (errors.length > 0) {
    return {
      applied: false,
      updated: 0,
      price,
      message: errors.map((error: any) => error.message).join(" "),
    };
  }
  return {
    applied: true,
    updated: changes.length,
    price,
    message: `Set ${changes.length} variant price(s) to ${target}`,
  };
}
