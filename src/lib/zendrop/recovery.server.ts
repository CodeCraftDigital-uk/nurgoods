/**
 * Self healing for supplier backed listings that were taken off sale.
 *
 * A hold is not a verdict for ever. If the supplier can once again evidence
 * the product, the destination shipping is fresh for a supported market and
 * the recalculated price clears every margin rule, the listing should come
 * back on sale without anyone having to notice.
 *
 * Two things are never restored automatically: a hold a person placed by hand,
 * and anything screened out on policy grounds. Those stay off until a person
 * clears them, because reinstating them is a judgement call and a compliance
 * risk, not a data refresh.
 */
import { intakeCredentials, shopifyGraphql } from "../services/shopify.server";
import { screenProhibited } from "../policy/prohibited";
import { ensureStorePublications } from "./store-publication.server";

const ACTIVATE_MUTATION = `
  mutation NurGoodsActivate($input: ProductInput!) {
    productUpdate(input: $input) {
      product { id status }
      userErrors { field message }
    }
  }
`;

const PRODUCT_STATE_QUERY = `
  query NurGoodsProductState($id: ID!) {
    product(id: $id) { id status title productType tags }
  }
`;

export interface RecoveryResult {
  restored: boolean;
  reason: string;
  channels: string[];
}

/**
 * Brings a held listing back on sale, headless channel only.
 *
 * The caller has already proven stock, deliverability and price. This function
 * re-checks the things that must never be bypassed by a data refresh, then
 * activates the product and republishes it through the same idempotent
 * publication plan the rest of the system uses, so the Online Store, Shop and
 * Point of Sale channels can never be reintroduced here.
 */
export async function restoreProductToSale(input: {
  shopifyProductId: string;
  manualHold: boolean;
  dryRun?: boolean;
}): Promise<RecoveryResult> {
  if (input.manualHold) {
    return {
      restored: false,
      reason: "A person placed this hold, so it is never lifted automatically.",
      channels: [],
    };
  }

  const credentials = await intakeCredentials();
  const state: any = await shopifyGraphql(credentials, PRODUCT_STATE_QUERY, {
    id: input.shopifyProductId,
  });
  const product = state?.product;
  if (!product) {
    return { restored: false, reason: "The store product could not be read back.", channels: [] };
  }

  const screening = screenProhibited({
    title: String(product.title ?? ""),
    productType: product.productType ? String(product.productType) : null,
    tags: Array.isArray(product.tags) ? product.tags.map((tag: unknown) => String(tag)) : [],
  });
  if (screening.prohibited) {
    return {
      restored: false,
      reason: `Policy screening still refuses this product (${screening.reason}), so it stays off sale.`,
      channels: [],
    };
  }

  if (input.dryRun) {
    return {
      restored: false,
      reason: "Dry run: the listing qualifies for restoration and would be brought back on sale.",
      channels: [],
    };
  }

  if (String(product.status ?? "").toUpperCase() !== "ACTIVE") {
    const activated: any = await shopifyGraphql(credentials, ACTIVATE_MUTATION, {
      input: { id: input.shopifyProductId, status: "ACTIVE" },
    });
    const errors = activated?.productUpdate?.userErrors ?? [];
    if (errors.length > 0) {
      return {
        restored: false,
        reason: errors.map((error: any) => String(error.message)).join(" "),
        channels: [],
      };
    }
  }

  const publication = await ensureStorePublications(input.shopifyProductId, undefined, {
    removeUnwanted: true,
  });

  return {
    restored: true,
    reason:
      "The supplier evidences the product again, delivery and price both clear, so it was brought back on sale on the approved sales channels.",
    channels: [...publication.published, ...publication.alreadyPublished],
  };
}
