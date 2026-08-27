/**
 * Draft first enforcement for supplier created products.
 *
 * The supplier can create a product directly in the store, and it has done so
 * already active. That puts an unpriced, uncategorised, unscreened listing in
 * front of customers before a single NUR GOODS gate has run. The rule is
 * simple and absolute: a product this platform did not verify does not stay on
 * sale, so it is pulled straight back off every channel and sent through
 * intake in the normal way.
 *
 * This never throws. Detection must not fail because a hold could not be
 * placed; the intake worker and the scheduled sweep are the backstops.
 */
import { requiresDraftFirst } from "@/lib/catalogue/repair";

export interface DraftFirstOutcome {
  held: boolean;
  reason: string;
}

export async function enforceDraftFirst(input: {
  shopifyProductId: string;
  origin: string | null | undefined;
  status: string | null | undefined;
}): Promise<DraftFirstOutcome> {
  try {
    if (String(input.status ?? "").toLowerCase() !== "active") {
      return { held: false, reason: "The product is not on sale" };
    }

    // A store event does not say who created the product. A supplier link is
    // the honest signal, so an unlabelled product that a supplier backs is
    // treated as supplier created rather than waved through.
    let origin = String(input.origin ?? "").toLowerCase();
    if (origin === "" || origin === "store") {
      const { zendropAdminClient } = await import("@/lib/zendrop/client.server");
      const supabase = await zendropAdminClient();
      const { data: link } = await supabase
        .from("product_supplier_links")
        .select("id")
        .eq("shopify_product_id", input.shopifyProductId)
        .maybeSingle();
      if (link) origin = "supplier";
    }

    const { isPricingVerified } = await import("@/lib/pricing/lifecycle.server");
    const pricingVerified = await isPricingVerified(input.shopifyProductId).catch(() => false);

    if (!requiresDraftFirst({ origin, status: input.status, pricingVerified })) {
      return { held: false, reason: "No hold was needed" };
    }

    const { holdProductFromSale } = await import("@/lib/pricing/integrity.server");
    const removed = await holdProductFromSale(input.shopifyProductId);
    return {
      held: true,
      reason: `A supplier created this product already on sale before it had been verified, so it was taken off ${
        removed.length > 0 ? removed.join(", ") : "every channel"
      } and set to draft until the intake and pricing gates have passed.`,
    };
  } catch (cause) {
    return {
      held: false,
      reason: cause instanceof Error ? cause.message : "The hold could not be placed",
    };
  }
}
