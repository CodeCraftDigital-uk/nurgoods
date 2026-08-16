/**
 * Mirrors supplier cost of goods from the store into the catalogue mirror.
 *
 * Cost is the only reliable, first party input we have for repricing existing
 * listings, so it is read straight from the commerce system of record and
 * stored verbatim. Nothing is inferred: a variant with no recorded cost stays
 * null and is held by the audit rather than guessed at.
 */
import { intakeCredentials, shopifyGraphql } from "../services/shopify.server";
import { zendropAdminClient } from "../zendrop/client.server";

const VARIANT_COST_QUERY = `
  query NurGoodsAllVariantCosts($cursor: String) {
    productVariants(first: 200, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        price
        product { id }
        inventoryItem { unitCost { amount currencyCode } }
      }
    }
  }
`;

export interface CostSyncResult {
  variantsSeen: number;
  variantsWithCost: number;
  variantsUpdated: number;
  message: string;
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function syncVariantCosts(): Promise<CostSyncResult> {
  const credentials = await intakeCredentials();
  const supabase = await zendropAdminClient();

  let cursor: string | null = null;
  let seen = 0;
  let withCost = 0;
  let updated = 0;
  const now = new Date().toISOString();

  for (let page = 0; page < 40; page += 1) {
    const data: any = await shopifyGraphql(credentials, VARIANT_COST_QUERY, { cursor });
    const connection = data?.productVariants;
    const nodes: any[] = connection?.nodes ?? [];
    if (nodes.length === 0) break;

    for (const node of nodes) {
      seen += 1;
      const variantId = String(node?.id ?? "");
      if (!variantId) continue;
      const cost = numeric(node?.inventoryItem?.unitCost?.amount);
      const currency = node?.inventoryItem?.unitCost?.currencyCode ?? null;
      if (cost !== null) withCost += 1;

      const { data: rows } = await supabase
        .from("shopify_product_variants")
        .update({
          unit_cost: cost,
          unit_cost_currency: currency,
          cost_source: cost === null ? null : "store_inventory_unit_cost",
          cost_synced_at: now,
        } as never)
        .eq("shopify_variant_id", variantId)
        .select("id");
      updated += (rows ?? []).length;
    }

    if (!connection?.pageInfo?.hasNextPage) break;
    cursor = connection.pageInfo.endCursor ?? null;
    if (!cursor) break;
  }

  return {
    variantsSeen: seen,
    variantsWithCost: withCost,
    variantsUpdated: updated,
    message: `Read ${seen} store variants, ${withCost} carry a recorded cost of goods, ${updated} mirror rows refreshed.`,
  };
}
