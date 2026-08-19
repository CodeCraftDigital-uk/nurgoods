import { discoverActions, callAction, zendropAdminClient } from "../../src/lib/zendrop/client.server";
const actions = await discoverActions();
const A = (n:string)=>actions.find((a:any)=>a.name===n)!;
for (const n of ["get_my_products","get_my_product","get_my_product_inventory","get_catalog_shipping_estimate"]) {
  console.log("### schema", n, JSON.stringify(A(n).inputSchema));
}
const r = await callAction(A("get_my_products"), { store_id: 3493831, page: 1, limit: 3 });
console.log("### get_my_products sample\n", JSON.stringify(r,null,1).slice(0,3000));
const first = (r?.items??[])[0];
if (first) {
  console.log("### get_my_product\n", JSON.stringify(await callAction(A("get_my_product"), { store_id:3493831, product_id: first.product_id ?? first.id }),null,1).slice(0,6000));
  console.log("### get_my_product_inventory\n", JSON.stringify(await callAction(A("get_my_product_inventory"), { store_id:3493831, product_id: first.product_id ?? first.id }),null,1).slice(0,6000));
}
