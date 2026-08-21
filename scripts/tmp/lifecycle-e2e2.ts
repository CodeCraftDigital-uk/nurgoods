import { shopifyGraphql } from "@/lib/zendrop/shopify-admin.server";
import { getShopifyCredentials } from "@/lib/zendrop/shopify-admin.server";
import { runPricingLifecycle } from "@/lib/pricing/lifecycle.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
const id = "gid://shopify/Product/15984393617738";
const c = await getShopifyCredentials();
const q = `query($id: ID!){ product(id:$id){ id title status metafields(first:5, namespace:"nur"){nodes{key value}} } }`;
const before: any = await shopifyGraphql(c, q, { id });
console.log("shopify before:", JSON.stringify(before.product));
// simulate a fresh import: mark pending
await supabaseAdmin.from("product_pricing_lifecycle").update({ status: "pending", verified_at: null } as never).eq("shopify_product_id", id);
const r = await runPricingLifecycle({ shopifyProductIds: [id], force: true });
console.log("outcome:", JSON.stringify(r.outcomes[0]));
const after: any = await shopifyGraphql(c, q, { id });
console.log("shopify after:", JSON.stringify(after.product));
