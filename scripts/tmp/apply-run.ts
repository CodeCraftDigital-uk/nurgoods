import { applyPricingAudit } from "../../src/lib/pricing/apply.server";
console.log(JSON.stringify(await applyPricingAudit({ runId: "dd179b29-be28-4b8b-b14a-3019dbc6c82a", userId: null }), null, 2).slice(0,3000));
