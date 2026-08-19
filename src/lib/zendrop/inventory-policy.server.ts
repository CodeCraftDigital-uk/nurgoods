/**
 * Oversell protection for supplier backed listings.
 *
 * The connected supplier plan exposes no stock quantity, so the store itself
 * has to be the thing that refuses to sell what cannot be evidenced. Two
 * settings do that: the variant continues selling policy must be DENY, and
 * individual variants that the supplier positively reports as unsellable are
 * driven to zero available stock so they cannot be added to a basket while
 * their healthy siblings stay on sale.
 *
 * Every mutation here is against our own store, never the supplier.
 */
import { intakeCredentials, shopifyGraphql } from "../services/shopify.server";

const VARIANT_POLICY_QUERY = `
  query NurGoodsVariantPolicy($id: ID!, $cursor: String) {
    product(id: $id) {
      id
      variants(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          sku
          inventoryPolicy
          inventoryItem { id tracked }
        }
      }
    }
  }
`;

const VARIANT_POLICY_MUTATION = `
  mutation NurGoodsVariantPolicyUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id inventoryPolicy }
      userErrors { field message }
    }
  }
`;

export interface VariantPolicyRow {
  variantId: string;
  sku: string | null;
  policy: string;
  inventoryItemId: string | null;
  tracked: boolean;
}

/** Reads the current continue selling policy for every variant of a product. */
export async function readVariantPolicies(shopifyProductId: string): Promise<VariantPolicyRow[]> {
  const credentials = await intakeCredentials();
  const rows: VariantPolicyRow[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 25; page += 1) {
    const data: any = await shopifyGraphql(credentials, VARIANT_POLICY_QUERY, {
      id: shopifyProductId,
      cursor,
    });
    for (const node of (data?.product?.variants?.nodes ?? []) as any[]) {
      rows.push({
        variantId: String(node.id),
        sku: node.sku ? String(node.sku) : null,
        policy: String(node.inventoryPolicy ?? "").toUpperCase(),
        inventoryItemId: node?.inventoryItem?.id ? String(node.inventoryItem.id) : null,
        tracked: Boolean(node?.inventoryItem?.tracked),
      });
    }
    if (!data?.product?.variants?.pageInfo?.hasNextPage) break;
    cursor = data.product.variants.pageInfo.endCursor;
  }
  return rows;
}

export interface InventoryPolicyResult {
  inspected: number;
  corrected: number;
  alreadyCompliant: number;
  message: string;
}

/**
 * Forces DENY on every variant of a supplier backed product, so no order can
 * be taken for stock the supplier has not evidenced. An explicit merchant
 * override skips the product entirely and reports that it did.
 */
export async function enforceNoOversell(input: {
  shopifyProductId: string;
  override?: boolean;
  dryRun?: boolean;
}): Promise<InventoryPolicyResult> {
  if (input.override) {
    return {
      inspected: 0,
      corrected: 0,
      alreadyCompliant: 0,
      message: "A merchant override is recorded for oversell policy, so it was left as configured.",
    };
  }

  const rows = await readVariantPolicies(input.shopifyProductId);
  const drifted = rows.filter((row) => row.policy !== "DENY");
  if (drifted.length === 0) {
    return {
      inspected: rows.length,
      corrected: 0,
      alreadyCompliant: rows.length,
      message: "Every variant already refuses oversell.",
    };
  }
  if (input.dryRun) {
    return {
      inspected: rows.length,
      corrected: 0,
      alreadyCompliant: rows.length - drifted.length,
      message: `${drifted.length} variant(s) allow oversell and would be corrected.`,
    };
  }

  const credentials = await intakeCredentials();
  // Shopify accepts at most 250 variants per bulk update.
  for (let index = 0; index < drifted.length; index += 100) {
    const slice = drifted.slice(index, index + 100);
    const result: any = await shopifyGraphql(credentials, VARIANT_POLICY_MUTATION, {
      productId: input.shopifyProductId,
      variants: slice.map((row) => ({ id: row.variantId, inventoryPolicy: "DENY" })),
    });
    const errors = result?.productVariantsBulkUpdate?.userErrors ?? [];
    if (errors.length > 0) {
      throw new Error(errors.map((error: any) => String(error.message)).join(" "));
    }
  }

  return {
    inspected: rows.length,
    corrected: drifted.length,
    alreadyCompliant: rows.length - drifted.length,
    message: `${drifted.length} variant(s) were switched to refuse oversell.`,
  };
}
