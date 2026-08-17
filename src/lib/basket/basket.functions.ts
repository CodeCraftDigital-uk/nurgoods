import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { VariantFacts } from "./model";

/**
 * Public basket services. These only read the mirrored catalogue and ask the
 * store to issue a cart, so the store stays the system of record for orders
 * and payment.
 */

const linesSchema = z
  .object({
    lines: z
      .array(
        z.object({
          variantId: z.string().min(1).max(120),
          quantity: z.number().int().min(1).max(10),
        }),
      )
      .min(1)
      .max(50),
  })
  .strict();

const variantsSchema = z
  .object({ variantIds: z.array(z.string().min(1).max(120)).max(50) })
  .strict();

/** Re-reads price and availability for the variants held in a basket. */
export const revalidateBasketFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => variantsSchema.parse(data))
  .handler(async ({ data }): Promise<{ facts: VariantFacts[] }> => {
    if (data.variantIds.length === 0) return { facts: [] };
    const { toVariantGid } = await import("@/lib/services/shopify-storefront.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const gidByNumeric = new Map<string, string>();
    for (const value of data.variantIds) {
      try {
        const gid = toVariantGid(value);
        gidByNumeric.set(gid, value.trim());
      } catch {
        /* an unusable identifier simply has no facts, so the line is dropped */
      }
    }
    if (gidByNumeric.size === 0) return { facts: [] };

    const { data: rows } = await supabaseAdmin
      .from("shopify_product_variants")
      .select("shopify_variant_id, price, compare_at_price, currency, available_for_sale")
      .in("shopify_variant_id", [...gidByNumeric.keys()]);

    const facts: VariantFacts[] = (rows ?? []).map((row: any) => ({
      variantId: gidByNumeric.get(row.shopify_variant_id) ?? row.shopify_variant_id,
      available: row.available_for_sale !== false,
      price: typeof row.price === "number" ? row.price : null,
      compareAtPrice: typeof row.compare_at_price === "number" ? row.compare_at_price : null,
      currency: row.currency ?? null,
    }));
    return { facts };
  });

/**
 * Creates ONE store cart containing every basket line and returns the checkout
 * link the store issued. No checkout URL is assembled here. Lines the store
 * cannot sell right now are dropped individually and reported back, so one
 * stale line never blocks the rest of the basket.
 */
export const createBasketCheckoutFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => linesSchema.parse(data))
  .handler(
    async ({
      data,
    }): Promise<{ checkoutUrl: string; totalQuantity: number; unavailable: string[] }> => {
      const {
        createStorefrontCartLines,
        checkVariantPurchasability,
        CHECKOUT_HOST_CONFLICT,
      } = await import("@/lib/services/shopify-storefront.server");
      const { buildCartLines, variantNumericId } = await import("./checkout-lines");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const built = buildCartLines(data.lines);
      const unavailable = new Set<string>(built.invalid);
      let lines = built.lines;

      // The store itself is the authority on what can be bought. The mirror is
      // only used as a fallback when the live check cannot be made.
      try {
        const { purchasable } = await checkVariantPurchasability(
          lines.map((line) => line.merchandiseId),
        );
        for (const line of lines) {
          if (!purchasable.has(line.merchandiseId)) {
            unavailable.add(variantNumericId(line.merchandiseId));
          }
        }
        lines = lines.filter((line) => purchasable.has(line.merchandiseId));
      } catch {
        const { data: rows } = await supabaseAdmin
          .from("shopify_product_variants")
          .select("shopify_variant_id, available_for_sale")
          .in(
            "shopify_variant_id",
            lines.map((line) => line.merchandiseId),
          );
        const sellable = new Set(
          (rows ?? [])
            .filter((row: any) => row.available_for_sale !== false)
            .map((row: any) => row.shopify_variant_id as string),
        );
        for (const line of lines) {
          if (!sellable.has(line.merchandiseId)) {
            unavailable.add(variantNumericId(line.merchandiseId));
          }
        }
        lines = lines.filter((line) => sellable.has(line.merchandiseId));
      }

      if (lines.length === 0) {
        throw new Error("Nothing in the basket can be ordered right now");
      }

      try {
        const cart = await createStorefrontCartLines({
          lines: lines.map((line) => ({
            variantId: line.merchandiseId,
            quantity: line.quantity,
          })),
        });
        for (const id of cart.rejected) unavailable.add(id);
        return {
          checkoutUrl: cart.checkoutUrl,
          totalQuantity: cart.totalQuantity,
          unavailable: [...unavailable],
        };
      } catch (error) {
        const raw = error instanceof Error ? error.message : "Checkout could not be started";
        const conflict = raw === CHECKOUT_HOST_CONFLICT;
        try {
          const { recordSyncEvent } = await import("@/lib/services/shopify.server");
          await recordSyncEvent(supabaseAdmin as never, {
            eventType: "storefront_checkout_failed",
            status: "failed",
            message: conflict
              ? "The store issues checkout links on the host serving this site, so the basket cannot open checkout."
              : raw,
            payload: { line_count: lines.length, unavailable: [...unavailable] },
          });
        } catch {
          /* diagnostics are best effort */
        }
        throw new Error(
          conflict
            ? "Checkout is being set up for this store. Please try again shortly."
            : "Checkout could not be started. Please try again.",
        );
      }
    },
  );

