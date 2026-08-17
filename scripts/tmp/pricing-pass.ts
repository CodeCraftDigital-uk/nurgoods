import { syncVariantCosts } from "../../src/lib/pricing/cost-sync.server";
import { runPricingAudit } from "../../src/lib/pricing/audit.server";
console.log(JSON.stringify(await syncVariantCosts(), null, 2));
console.log(JSON.stringify(await runPricingAudit(null), null, 2));
