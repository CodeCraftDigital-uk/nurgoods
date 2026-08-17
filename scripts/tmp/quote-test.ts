import { callAction, zendropAdminClient } from "../../src/lib/zendrop/client.server";
const a=(n:string)=>({name:n,description:"",inputSchema:{},kind:"read" as const});
const sb = await zendropAdminClient();
const { data } = await sb.from("product_supplier_links").select("shopify_product_id,supplier_product_id,supplier_import_list_id,shipping_cost,evidence").is("shipping_cost", null);
console.log("links missing shipping:", (data??[]).length);
for (const r of (data??[]).slice(0,4) as any[]) {
  const p = await callAction(a("get_catalog_shipping_estimate"), { product_id: Number(r.supplier_product_id), country_code: "gb" }).catch((e:any)=>({error:String(e).slice(0,200)}));
  console.log(r.supplier_product_id, JSON.stringify(p).slice(0,600));
}
