import { getZendropProduct } from "../../src/lib/zendrop/catalogue.server";
import { zendropAdminClient, callAction, loadCapabilityMap } from "../../src/lib/zendrop/client.server";
const sb = await zendropAdminClient();
const { data } = await sb.from("product_supplier_links").select("supplier_product_id,supplier_import_list_id,variant_map").limit(3);
const roles = await loadCapabilityMap();
console.log("ROLES", JSON.stringify(Object.fromEntries(Object.entries(roles).map(([k,v]:any)=>[k,v?.name??null]))));
for (const l of data??[]) {
  const p = await getZendropProduct(String(l.supplier_product_id), "GB");
  console.log("PRODUCT", l.supplier_product_id, JSON.stringify({inv:p?.inventory, cost:p?.cost, cur:p?.currency, ship:p?.shippingCost, variants:p?.variants.length}));
  const mp:any = await callAction({name:"get_my_product",description:"",inputSchema:{},kind:"read"} as any, { import_list_id: Number(l.supplier_import_list_id) });
  const v = (mp?.variants ?? mp?.product?.variants ?? [])[0];
  console.log("  MYPRODUCT keys", Object.keys(mp?.product ?? mp ?? {}).join(","));
  console.log("  VARIANT0", JSON.stringify(v));
}
