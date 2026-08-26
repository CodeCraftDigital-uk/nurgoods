/**
 * One-shot guarded activation for the completed v5 catalogue repair.
 *
 * Only lifecycle-verified v5 products are presented to the existing activation
 * service. That service rechecks sellability, the pricing lifecycle, the
 * merchant switch and channel publication. The switch is restored off even if
 * this process is interrupted by an application error.
 */
import { supabaseAdmin as db } from "@/integrations/supabase/client.server";
import { activateForStorefront } from "@/lib/intake/activation.server";
import { PRICING_FORMULA_VERSION } from "@/lib/pricing/authority.server";
import { reconcileLiveCatalogue } from "@/lib/pricing/catalogue-reconcile.server";

const PAGE = 200;
const CONCURRENCY = 5;

async function verifiedProductIds(): Promise<string[]> {
  const ids: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("product_pricing_lifecycle")
      .select("shopify_product_id")
      .eq("status", "verified")
      .eq("formula_version", PRICING_FORMULA_VERSION)
      .order("shopify_product_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as Array<{ shopify_product_id: string }>;
    ids.push(...rows.map((row) => String(row.shopify_product_id)));
    if (rows.length < PAGE) break;
  }
  return Array.from(new Set(ids));
}

await db
  .from("pricing_formula_policy")
  .update({ activation_enabled: true } as never)
  .eq("id", true);

const totals = { candidates: 0, activated: 0, alreadyActive: 0, failed: 0 };
const failures: string[] = [];

try {
  const ids = await verifiedProductIds();
  totals.candidates = ids.length;
  console.log("CANDIDATES", ids.length, PRICING_FORMULA_VERSION);

  for (let start = 0; start < ids.length; start += CONCURRENCY) {
    const batch = ids.slice(start, start + CONCURRENCY);
    const outcomes = await Promise.all(
      batch.map(async (id) => ({ id, result: await activateForStorefront(id, "supplier") })),
    );
    for (const { id, result } of outcomes) {
      if (result.ok) {
        if (result.activated) totals.activated += 1;
        else totals.alreadyActive += 1;
      } else {
        totals.failed += 1;
        failures.push(`${id}: ${result.message}`);
      }
    }
    console.log("PROGRESS", Math.min(start + CONCURRENCY, ids.length), JSON.stringify(totals));
  }

  console.log("RECONCILE", JSON.stringify(await reconcileLiveCatalogue()));
} finally {
  await db
    .from("pricing_formula_policy")
    .update({ activation_enabled: false } as never)
    .eq("id", true);
}

console.log("TOTAL", JSON.stringify(totals));
console.log("FAILURES", JSON.stringify(failures));