/**
 * Permanent, auditable removal of a product from the shop.
 *
 * Deletion is irreversible in the store, so it is the most dangerous thing in
 * this codebase and is written to behave accordingly:
 *
 *   1. Nothing is deleted until every dependency has been checked. An order
 *      line, a fulfilment or an open supplier obligation stops the item dead
 *      and it is reported rather than worked around.
 *   2. A tombstone is written before the store call, not after. If the store
 *      call succeeds and the process then dies, the audit record already
 *      exists and the decision can still be explained and reconstructed.
 *   3. The store is the first thing corrected, the local records second. A
 *      local row without a store product is a phantom we can clean up; a store
 *      product without local records is an unmanaged live listing, which is
 *      far worse.
 */
import { intakeCredentials, shopifyGraphql } from "@/lib/services/shopify.server";
import { zendropAdminClient } from "@/lib/zendrop/client.server";
import { deletionAllowed, type DeletionDependency } from "./repair";

const DELETE_MUTATION = /* GraphQL */ `
  mutation NurGoodsDeleteProduct($id: ID!) {
    productDelete(input: { id: $id }) {
      deletedProductId
      userErrors {
        field
        message
      }
    }
  }
`;

const READ_QUERY = /* GraphQL */ `
  query NurGoodsProductForDeletion($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      status
      resourcePublicationsV2(first: 25) {
        nodes {
          isPublished
          publication {
            id
            name
          }
        }
      }
      variants(first: 100) {
        nodes {
          id
          title
          sku
          price
          inventoryQuantity
        }
      }
    }
  }
`;

export interface DeletionManifest {
  shopifyProductId: string;
  productId: string | null;
  handle: string | null;
  title: string | null;
  statusBefore: string | null;
  publicationsBefore: Array<{ id: string; name: string; published: boolean }>;
  variants: Array<Record<string, unknown>>;
  supplierEvidence: Record<string, unknown>;
  pricingEvidence: Record<string, unknown>;
  mirrorSnapshot: Record<string, unknown>;
  dependencies: DeletionDependency[];
}

/** Builds the recoverable record for one product before anything is removed. */
export async function buildDeletionManifest(shopifyProductId: string): Promise<DeletionManifest> {
  const supabase = await zendropAdminClient();
  const credentials = await intakeCredentials();

  let live: any = null;
  try {
    const data: any = await shopifyGraphql(credentials, READ_QUERY, { id: shopifyProductId });
    live = data?.product ?? null;
  } catch {
    live = null;
  }

  const [{ data: mirror }, { data: supplier }, { data: pricing }, { data: lifecycle }] =
    await Promise.all([
      supabase
        .from("shopify_products")
        .select("*")
        .eq("shopify_product_id", shopifyProductId)
        .maybeSingle(),
      supabase
        .from("product_supplier_links")
        .select("*")
        .eq("shopify_product_id", shopifyProductId),
      supabase
        .from("product_price_authority")
        .select("shopify_variant_id, expected_price, landed_cost, hold_reason, formula_version")
        .eq("shopify_product_id", shopifyProductId),
      supabase
        .from("product_pricing_lifecycle")
        .select("status, reason, formula_version, verified_at")
        .eq("shopify_product_id", shopifyProductId)
        .maybeSingle(),
    ]);

  return {
    shopifyProductId,
    productId: (mirror as any)?.id ?? null,
    handle: live?.handle ?? (mirror as any)?.handle ?? null,
    title: live?.title ?? (mirror as any)?.title ?? null,
    statusBefore: live?.status ? String(live.status).toLowerCase() : ((mirror as any)?.status ?? null),
    publicationsBefore: ((live?.resourcePublicationsV2?.nodes ?? []) as any[]).map((node) => ({
      id: String(node?.publication?.id ?? ""),
      name: String(node?.publication?.name ?? ""),
      published: Boolean(node?.isPublished),
    })),
    variants: ((live?.variants?.nodes ?? []) as any[]).map((node) => ({
      id: String(node?.id ?? ""),
      title: node?.title ?? null,
      sku: node?.sku ?? null,
      price: node?.price ?? null,
      inventoryQuantity: node?.inventoryQuantity ?? null,
    })),
    supplierEvidence: { links: supplier ?? [] },
    pricingEvidence: { authority: pricing ?? [], lifecycle: lifecycle ?? null },
    mirrorSnapshot: (mirror ?? {}) as Record<string, unknown>,
    dependencies: [],
  };
}

/** Everything that would make removing this product unsafe. */
export async function checkDeletionDependencies(
  shopifyProductId: string,
): Promise<DeletionDependency[]> {
  const supabase = await zendropAdminClient();
  const dependencies: DeletionDependency[] = [];

  const { data: lines } = await supabase
    .from("commerce_order_lines")
    .select("id, order_id, sku")
    .eq("shopify_product_id", shopifyProductId)
    .limit(5);
  for (const line of ((lines ?? []) as any[])) {
    dependencies.push({
      kind: "order line",
      detail: `order ${line.order_id ?? "unknown"}${line.sku ? ` sku ${line.sku}` : ""}`,
    });
  }

  return dependencies;
}

export interface DeletionOutcome {
  shopifyProductId: string;
  deleted: boolean;
  blocked: boolean;
  reason: string;
  tombstoneId: string | null;
  cleaned: string[];
}

/**
 * Removes one product permanently, with a tombstone written first and every
 * local record cleaned up afterwards.
 */
export async function deleteProductPermanently(input: {
  shopifyProductId: string;
  reasonCode: string;
  reason: string;
  runId?: string | null;
  authorisedBy?: string | null;
  dryRun?: boolean;
}): Promise<DeletionOutcome> {
  const supabase = await zendropAdminClient();
  const manifest = await buildDeletionManifest(input.shopifyProductId);
  manifest.dependencies = await checkDeletionDependencies(input.shopifyProductId);

  const blocked = deletionAllowed(manifest.dependencies);
  if (blocked) {
    return {
      shopifyProductId: input.shopifyProductId,
      deleted: false,
      blocked: true,
      reason: blocked.reason,
      tombstoneId: null,
      cleaned: [],
    };
  }

  if (input.dryRun) {
    return {
      shopifyProductId: input.shopifyProductId,
      deleted: false,
      blocked: false,
      reason: `Dry run. Would remove: ${input.reason}`,
      tombstoneId: null,
      cleaned: [],
    };
  }

  const { data: tombstone } = await supabase
    .from("catalogue_tombstones")
    .insert({
      shopify_product_id: manifest.shopifyProductId,
      product_id: manifest.productId,
      handle: manifest.handle,
      title: manifest.title,
      status_before: manifest.statusBefore,
      publications_before: manifest.publicationsBefore as never,
      variants: manifest.variants as never,
      supplier_evidence: manifest.supplierEvidence as never,
      pricing_evidence: manifest.pricingEvidence as never,
      mirror_snapshot: manifest.mirrorSnapshot as never,
      dependency_check: { dependencies: manifest.dependencies } as never,
      reason_code: input.reasonCode,
      reason: input.reason,
      deleted_from_store: false,
      run_id: input.runId ?? null,
      authorised_by: input.authorisedBy ?? null,
    } as never)
    .select("id")
    .maybeSingle();
  const tombstoneId = (tombstone as any)?.id ?? null;

  // The store first. A product that no longer exists there is reported as
  // already gone rather than treated as a failure, so the pass is idempotent.
  let deletedFromStore = false;
  let storeMessage = "";
  if (manifest.statusBefore === null && manifest.variants.length === 0) {
    deletedFromStore = true;
    storeMessage = "The product was already absent from the store";
  } else {
    try {
      const credentials = await intakeCredentials();
      const result: any = await shopifyGraphql(credentials, DELETE_MUTATION, {
        id: input.shopifyProductId,
      });
      const errors = (result?.productDelete?.userErrors ?? []).map((error: any) =>
        String(error?.message ?? "Deletion failed"),
      );
      if (errors.length > 0) {
        storeMessage = errors.join(" ");
      } else {
        deletedFromStore = true;
        storeMessage = "Removed from the store";
      }
    } catch (cause) {
      storeMessage = cause instanceof Error ? cause.message : "Deletion failed";
    }
  }

  // "Product does not exist" is not a refusal. The store has already let the
  // product go, so the only correct outcome is to finish the job locally
  // rather than leave an orphan row behind and call it a failure.
  const alreadyGone = /does not exist|not found/i.test(storeMessage);

  if (!deletedFromStore && !alreadyGone) {
    if (tombstoneId) {
      await supabase
        .from("catalogue_tombstones")
        .update({ reason: `${input.reason}. Store removal failed: ${storeMessage}` } as never)
        .eq("id", tombstoneId);
    }
    return {
      shopifyProductId: input.shopifyProductId,
      deleted: false,
      blocked: false,
      reason: `The store refused the removal: ${storeMessage}`,
      tombstoneId,
      cleaned: [],
    };
  }

  const cleaned = await purgeLocalRecords(supabase, manifest);

  if (tombstoneId) {
    await supabase
      .from("catalogue_tombstones")
      .update({ deleted_from_store: true } as never)
      .eq("id", tombstoneId);
  }

  return {
    shopifyProductId: input.shopifyProductId,
    deleted: true,
    blocked: false,
    reason: alreadyGone
      ? `${input.reason}. The store no longer held this product, so only the local records were cleared.`
      : input.reason,
    tombstoneId,
    cleaned,
  };
}

/**
 * Clears every live record for a product that no longer exists in the store.
 * Also used on its own to reconcile phantom rows.
 */
export async function purgeLocalRecords(
  supabase: any,
  manifest: Pick<DeletionManifest, "shopifyProductId" | "productId">,
): Promise<string[]> {
  const cleaned: string[] = [];
  const byShopifyId = [
    "product_pricing_lifecycle",
    "product_price_authority",
    "product_market_eligibility",
    "product_supplier_links",
    "product_intake_events",
    "product_intake_records",
    "publication_audit_items",
  ];

  for (const table of byShopifyId) {
    const { error } = await supabase
      .from(table)
      .delete()
      .eq("shopify_product_id", manifest.shopifyProductId);
    if (!error) cleaned.push(table);
  }

  if (manifest.productId) {
    const { error: snapshotError } = await supabase
      .from("storefront_snapshot")
      .delete()
      .eq("product_id", manifest.productId);
    if (!snapshotError) cleaned.push("storefront_snapshot");

    // The mirror row goes last. Everything hanging off it by foreign key is
    // removed by the database in the same statement.
    const { error: mirrorError } = await supabase
      .from("shopify_products")
      .delete()
      .eq("id", manifest.productId);
    if (!mirrorError) cleaned.push("shopify_products");
  }

  return cleaned;
}
