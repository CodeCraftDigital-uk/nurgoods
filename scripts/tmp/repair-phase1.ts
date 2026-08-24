/** Operational: reconcile live Shopify, then refresh supplier costs. */
const { reconcileLiveCatalogue } = await import("@/lib/pricing/catalogue-reconcile.server");
const r = await reconcileLiveCatalogue({});
console.log("RECONCILE", JSON.stringify(r));
const { syncVariantCosts } = await import("@/lib/pricing/cost-sync.server");
let cursor: string | null = null, seen = 0, withCost = 0, updated = 0;
for (let i = 0; i < 60; i += 1) {
  const x: any = await syncVariantCosts({ cursor, maxPages: 5 });
  seen += x.variantsSeen; withCost += x.variantsWithCost; updated += x.variantsUpdated;
  cursor = x.nextCursor; if (!cursor) break;
}
console.log("COSTS", JSON.stringify({ seen, withCost, missing: seen - withCost, updated, exhausted: !cursor }));
console.log("PHASE1_DONE");
