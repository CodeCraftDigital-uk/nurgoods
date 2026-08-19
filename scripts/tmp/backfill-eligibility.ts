/**
 * Read only market eligibility backfill.
 * Asks the supplier for destination shipping quotes for products that have no
 * recorded GB/US evidence yet, in bounded batches. It never creates, confirms
 * or pays for a supplier order. Markets without a usable quote stay ineligible.
 */
import { refreshShippingQuotes } from "../../src/lib/pricing/shipping-quotes.server";
import { summariseMarketCoverage } from "../../src/lib/pricing/market-eligibility.server";
import { loadPricingSettings } from "../../src/lib/zendrop/import.server";

const settings = await loadPricingSettings();
const before = await summariseMarketCoverage(settings.supported_markets);
console.log("coverage before:", JSON.stringify(before));

const batches = Number(process.argv[2] ?? 3);
for (let i = 0; i < batches; i += 1) {
  const run = await refreshShippingQuotes({ limit: 40 });
  console.log(
    `batch ${i + 1}: attempted ${run.attempted}, refreshed ${run.refreshed}, unavailable ${run.unavailable}, eligible ${run.marketEligible}, failures ${run.failures.length}`,
  );
  if (run.failures.length > 0) console.log("  first failure:", run.failures[0]);
  if (run.attempted === 0) break;
}

const after = await summariseMarketCoverage(settings.supported_markets);
console.log("coverage after:", JSON.stringify(after));
