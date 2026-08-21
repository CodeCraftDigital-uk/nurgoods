import { runPricingLifecycle, readLifecycleState } from "@/lib/pricing/lifecycle.server";
const id = "gid://shopify/Product/15984393617738";
console.log("before:", JSON.stringify(await readLifecycleState(id)));
const r = await runPricingLifecycle({ shopifyProductIds: [id], force: true });
console.log("run:", JSON.stringify(r, null, 2));
console.log("after:", JSON.stringify(await readLifecycleState(id)));
