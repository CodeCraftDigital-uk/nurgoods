import { discoverActions, callAction, zendropAdminClient } from "../../src/lib/zendrop/client.server";
const actions = await discoverActions();
console.log("LIVE ACTIONS", actions.length);
console.log(actions.map((a:any)=>a.name).join(", "));
console.log("WEBHOOK-ISH:", actions.filter((a:any)=>/hook|subscri|event|callback|notif/i.test(a.name)).map(a=>a.name));
const sb = await zendropAdminClient();
const { data: links } = await sb.from("product_supplier_links").select("supplier_product_id").not("supplier_product_id","is",null).limit(2);
const getP = actions.find((a:any)=>/get.*product/i.test(a.name) && !/my_/.test(a.name));
console.log("using", getP?.name, JSON.stringify(getP?.inputSchema));
for (const l of links??[]) {
  const r = await callAction(getP!, { product_id: Number(l.supplier_product_id) });
  console.log("=== product", l.supplier_product_id);
  console.log(JSON.stringify(r,null,1).slice(0,6000));
}
