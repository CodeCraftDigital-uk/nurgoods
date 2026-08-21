import { runPricingLifecycle, readLifecycleState } from "@/lib/pricing/lifecycle.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
const id = "gid://shopify/Product/15984393617738";
await supabaseAdmin.from("product_pricing_lifecycle").update({ status: "pending", verified_at: null } as never).eq("shopify_product_id", id);
console.log("state after reset:", JSON.stringify(await readLifecycleState(id)));
const r = await runPricingLifecycle({ shopifyProductIds: [id], force: true });
console.log("outcome:", JSON.stringify(r.outcomes[0], null, 2));
console.log("state after run:", JSON.stringify(await readLifecycleState(id)));
