import { runPricingLifecycleRetries } from "../../src/lib/pricing/lifecycle.server";
const r = await runPricingLifecycleRetries(8);
console.log(r.message);
for (const o of r.outcomes) console.log(o.status, o.shopifyProductId.split("/").pop(), "|", o.reason, "|", o.activation, "|", o.publication);
