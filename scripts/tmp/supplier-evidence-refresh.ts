/** Operational: supplier linkage recovery + cost sync + GB/US shipping quote refresh. */
const step = process.argv[2] ?? "all";

if (step === "linkage" || step === "all") {
  const { recoverSupplierLinkage } = await import("@/lib/pricing/linkage.server");
  const result = await recoverSupplierLinkage();
  console.log("LINKAGE", JSON.stringify(result, null, 2));
}

if (step === "costs" || step === "all") {
  const { syncVariantCosts } = await import("@/lib/pricing/cost-sync.server");
  let cursor: string | null = null;
  let seen = 0;
  let withCost = 0;
  let updated = 0;
  for (let i = 0; i < 40; i += 1) {
    const r: any = await syncVariantCosts({ cursor, maxPages: 5 });
    seen += r.variantsSeen;
    withCost += r.variantsWithCost;
    updated += r.variantsUpdated;
    cursor = r.nextCursor;
    if (!cursor) break;
  }
  console.log("COSTS", JSON.stringify({ seen, withCost, missing: seen - withCost, updated, exhausted: !cursor }));
}

if (step === "shipping" || step === "all") {
  const { refreshShippingQuotes } = await import("@/lib/pricing/shipping-quotes.server");
  const r = await refreshShippingQuotes({ limit: 200 });
  console.log("SHIPPING", JSON.stringify({ ...r, failures: r.failures.slice(0, 10), failureCount: r.failures.length }, null, 2));
}

if (step === "fx") {
  const { getFxRate } = await import("@/lib/zendrop/fx.server");
  console.log("FX", JSON.stringify(await getFxRate("USD", "GBP")));
}
