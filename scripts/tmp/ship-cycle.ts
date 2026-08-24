/** Operational: run one complete GB/US shipping refresh cycle. */
const { refreshShippingQuotes } = await import("@/lib/pricing/shipping-quotes.server");
let reset = true;
for (let pass = 1; pass <= 12; pass += 1) {
  const r = await refreshShippingQuotes({ limit: 200, reset });
  reset = false;
  console.log("PASS", pass, JSON.stringify({ cycle: r.cycle, attempted: r.attempted, refreshed: r.refreshed, unavailable: r.unavailable, marketEligible: r.marketEligible, remaining: r.remaining, failures: r.failures.length, sample: r.failures.slice(0, 3) }));
  if (r.remaining === 0 || r.attempted === 0) break;
}
console.log("SHIP_CYCLE_DONE");
