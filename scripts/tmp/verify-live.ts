import { intakeCredentials, shopifyGraphql } from "../../src/lib/services/shopify.server";
import { zendropAdminClient } from "../../src/lib/zendrop/client.server";
const sb = await zendropAdminClient();
const { data } = await sb.from("product_price_revisions").select("shopify_variant_id,new_price,old_price,variant_title,shopify_product_id").order("created_at",{ascending:false}).limit(12);
const creds = await intakeCredentials();
let mismatch = 0;
for (const r of (data ?? []) as any[]) {
  const res: any = await shopifyGraphql(creds, `query($id: ID!){ node(id:$id){ ... on ProductVariant { id price title product { title } } } }`, { id: r.shopify_variant_id });
  const live = Number(res?.node?.price);
  const ok = Math.abs(live - Number(r.new_price)) < 0.005;
  if (!ok) mismatch++;
  console.log(ok ? "OK " : "BAD", res?.node?.product?.title?.slice(0,40), "|", res?.node?.title?.slice(0,30), "live", live, "expected", r.new_price, "was", r.old_price);
}
console.log("mismatches", mismatch);
const { data: rng } = await sb.rpc("noop").catch(()=>({data:null}));
