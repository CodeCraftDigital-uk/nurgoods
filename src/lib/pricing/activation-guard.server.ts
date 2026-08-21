/**
 * Reasons a product must not be put on sale even when its pricing verified.
 *
 * Verified pricing answers one question only: is the price correct. It does
 * not overrule safety decisions taken elsewhere, so the pricing lifecycle
 * checks here before it activates anything.
 */
import { zendropAdminClient } from "../zendrop/client.server";

/** Intake states that represent a deliberate decision not to sell. */
const BLOCKING_INTAKE_STATES = ["quarantined", "rejected", "failed"];

/**
 * Returns a plain reason when the product must stay unpublished, or null when
 * the pricing lifecycle is free to activate it.
 */
export async function blockedFromActivation(shopifyProductId: string): Promise<string | null> {
  const supabase = await zendropAdminClient();
  const { data: mirror } = await supabase
    .from("shopify_products")
    .select("id")
    .eq("shopify_product_id", shopifyProductId)
    .maybeSingle();
  const productId = (mirror as any)?.id ?? null;
  if (!productId) return null;

  const { data: intake } = await supabase
    .from("product_intake_records")
    .select("state")
    .eq("product_id", productId)
    .in("state", BLOCKING_INTAKE_STATES)
    .limit(1);
  if ((intake ?? []).length > 0) {
    return `held back: the product is ${String((intake as any[])[0].state)} in catalogue intake`;
  }

  const { data: duplicate } = await supabase
    .from("duplicate_group_members")
    .select("product_id")
    .eq("product_id", productId)
    .eq("suppressed", true)
    .limit(1);
  if ((duplicate ?? []).length > 0) {
    return "held back: the product is suppressed as a confirmed duplicate";
  }

  return null;
}
