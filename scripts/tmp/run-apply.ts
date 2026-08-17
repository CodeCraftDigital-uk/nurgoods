import { applyPricingAudit } from "../../src/lib/pricing/apply.server";
const res = await applyPricingAudit({
  runId: "c7c436b0-c310-43cd-9679-82c054708a7e",
  userId: "235b555f-0303-4dcb-8fa6-3db546fdae1e",
});
console.log(JSON.stringify(res, null, 2).slice(0, 4000));
