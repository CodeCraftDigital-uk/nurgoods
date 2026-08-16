/**
 * Applies a reviewed pricing audit to the commerce system of record.
 *
 * Only lines an administrator has reviewed and that the audit classified as
 * ready to reprice are ever touched. Every change is written to the store
 * first, then mirrored locally and recorded in the revision history with the
 * full formula inputs. Mirroring the new price straight away is what stops the
 * store webhook echoing back a change the platform would treat as new.
 */
import { intakeCredentials, shopifyGraphql } from "../services/shopify.server";
import { zendropAdminClient } from "../zendrop/client.server";
import { loadPricingSettings } from "../zendrop/import.server";
import type { ApplyPricingResult } from "./types";

const VARIANT_PRICE_MUTATION = `
  mutation NurGoodsRepriceVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id price }
      userErrors { field message }
    }
  }
`;

export async function applyPricingAudit(input: {
  runId: string;
  itemIds?: string[] | undefined;
  userId: string;
}): Promise<ApplyPricingResult> {
  const supabase = await zendropAdminClient();
  const settings = await loadPricingSettings();

  let query = supabase
    .from("pricing_audit_items")
    .select("*")
    .eq("run_id", input.runId)
    .eq("status", "ready_to_reprice");
  if (input.itemIds && input.itemIds.length > 0) query = query.in("id", input.itemIds);
  const { data } = await query;

  const items = (data ?? []) as any[];
  const result: ApplyPricingResult = {
    attempted: items.length,
    updated: 0,
    skipped: 0,
    failures: [],
    message: "",
  };
  if (items.length === 0) {
    result.message = "There was nothing eligible to reprice in this audit run.";
    return result;
  }

  const credentials = await intakeCredentials();
  const byProduct = new Map<string, any[]>();
  for (const item of items) {
    const key = String(item.shopify_product_id);
    byProduct.set(key, [...(byProduct.get(key) ?? []), item]);
  }

  for (const [productId, group] of byProduct) {
    const changes = group
      .filter((item) => typeof item.calculated_price === "number" || item.calculated_price !== null)
      .map((item) => ({
        id: String(item.shopify_variant_id),
        price: Number(item.calculated_price).toFixed(2),
      }));
    if (changes.length === 0) {
      result.skipped += group.length;
      continue;
    }

    try {
      const response: any = await shopifyGraphql(credentials, VARIANT_PRICE_MUTATION, {
        productId,
        variants: changes,
      });
      const errors = response?.productVariantsBulkUpdate?.userErrors ?? [];
      if (errors.length > 0) {
        result.skipped += group.length;
        result.failures.push(
          `${group[0]?.product_title ?? productId}: ${errors.map((e: any) => e.message).join(" ")}`,
        );
        continue;
      }
    } catch (cause) {
      result.skipped += group.length;
      result.failures.push(
        `${group[0]?.product_title ?? productId}: ${
          cause instanceof Error ? cause.message : "The store rejected the price update"
        }`,
      );
      continue;
    }

    for (const item of group) {
      const newPrice = Number(item.calculated_price);
      await supabase
        .from("shopify_product_variants")
        .update({ price: newPrice } as never)
        .eq("shopify_variant_id", String(item.shopify_variant_id));

      await supabase.from("product_price_revisions").insert({
        run_id: input.runId,
        product_id: item.product_id,
        shopify_product_id: String(item.shopify_product_id),
        shopify_variant_id: String(item.shopify_variant_id),
        variant_title: item.variant_title,
        old_price: item.current_price,
        new_price: newPrice,
        unit_cost: item.unit_cost,
        shipping_cost: item.shipping_cost,
        landed_cost: item.landed_cost,
        target_margin: settings.target_margin,
        rounding_mode: settings.rounding_mode,
        cost_source: item.cost_source,
        shipping_source: item.shipping_source,
        source: "admin_reprice",
        applied_by: input.userId,
      } as never);

      await supabase
        .from("pricing_audit_items")
        .update({ status: "already_correct", reason: "Repriced by an administrator" } as never)
        .eq("id", item.id);

      result.updated += 1;
    }

    // Keep the product price range in the mirror consistent with the variants.
    const { data: variants } = await supabase
      .from("shopify_product_variants")
      .select("price")
      .eq("product_id", group[0]?.product_id);
    const prices = ((variants ?? []) as any[])
      .map((row) => Number(row.price))
      .filter((value) => Number.isFinite(value));
    if (prices.length > 0 && group[0]?.product_id) {
      await supabase
        .from("shopify_products")
        .update({
          price_min: Math.min(...prices),
          price_max: Math.max(...prices),
        } as never)
        .eq("id", group[0].product_id);
    }
  }

  result.message = `${result.updated} variant price(s) updated in the store, ${result.skipped} left unchanged.`;
  return result;
}
