import { zendropAdminClient } from "../../src/lib/zendrop/client.server";
const sb = await zendropAdminClient();
const { bad } = await Bun.file("scripts/tmp/live-active.json").json();
const pids = [...new Set(bad.map((b:any)=>b.pid as string))];
const { data: prods } = await sb.from("shopify_products").select("id,shopify_product_id,title,handle,status").in("shopify_product_id", pids);
const { data: cands } = await sb.from("zendrop_import_candidates").select("id,product_id,shopify_product_id,title,shipping_cost,supplier_cost,status,linked_at,calculated_price").in("shopify_product_id", pids);
const { data: links } = await sb.from("product_supplier_links").select("product_id,shopify_product_id,shipping_cost,shipping_source,match_confidence").in("shopify_product_id", pids);
const { data: dupes } = await sb.from("duplicate_group_members").select("product_id,suppressed");
const sup = new Set((dupes??[]).filter((d:any)=>d.suppressed).map((d:any)=>String(d.product_id)));
for (const pid of pids) {
  const p:any = (prods??[]).find((x:any)=>String(x.shopify_product_id)===pid);
  const c:any = (cands??[]).find((x:any)=>String(x.shopify_product_id)===pid);
  const l:any = (links??[]).find((x:any)=>String(x.shopify_product_id)===pid);
  const n = bad.filter((b:any)=>b.pid===pid).length;
  console.log(JSON.stringify({ pid, title: (p?.title??bad.find((b:any)=>b.pid===pid).product).slice(0,45), n, mirrorStatus:p?.status, suppressed: p? sup.has(String(p.id)):null, cand: c? {ship:c.shipping_cost, cost:c.supplier_cost, st:c.status, calc:c.calculated_price, linked:!!c.linked_at}:null, link: l? {ship:l.shipping_cost, src:l.shipping_source, conf:l.match_confidence}:null }));
}
