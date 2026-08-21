import { supabaseAdmin as db } from "@/integrations/supabase/client.server";
import { repriceProducts } from "@/lib/pricing/authority.server";

const dryRun = process.argv[2] !== "apply";
const batch = Number(process.argv[3] ?? 20);

const { data } = await db
  .from("shopify_products")
  .select("shopify_product_id, status")
  .order("shopify_product_id", { ascending: true });
const ids = ((data ?? []) as any[]).map((r) => String(r.shopify_product_id));
console.log("products", ids.length, "dryRun", dryRun);

const total = { products: 0, variants: 0, inSync: 0, repriced: 0, held: 0, failed: 0, compareAtCleared: 0 };
for (let i = 0; i < ids.length; i += batch) {
  const slice = ids.slice(i, i + batch);
  try {
    const r = await repriceProducts({ shopifyProductIds: slice, dryRun });
    total.products += r.products;
    total.variants += r.variants;
    total.inSync += r.inSync;
    total.repriced += r.repriced;
    total.held += r.held;
    total.failed += r.failed;
    total.compareAtCleared += r.compareAtCleared;
    console.log(i, JSON.stringify(total), r.examples.slice(0, 2).join(" | "));
  } catch (cause) {
    console.log(i, "batch_error", cause instanceof Error ? cause.message : cause);
  }
}
console.log("TOTAL", JSON.stringify(total));
