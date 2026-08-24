const { refreshShippingQuotes } = await import("@/lib/pricing/shipping-quotes.server");
for (let pass = 1; pass <= 4; pass += 1) {
  const r = await refreshShippingQuotes({ limit: 200 });
  console.log("PASS", pass, JSON.stringify({ attempted: r.attempted, refreshed: r.refreshed, unavailable: r.unavailable, marketEligible: r.marketEligible, markets: r.markets, failureCount: r.failures.length, sample: r.failures.slice(0, 5) }));
  if (r.attempted === 0) break;
}
console.log("SHIPPING_DONE");
