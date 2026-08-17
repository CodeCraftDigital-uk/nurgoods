import { intakeCredentials, shopifyGraphql } from "../../src/lib/services/shopify.server";
import { zendropAdminClient } from "../../src/lib/zendrop/client.server";
const c = await intakeCredentials(); const sb = await zendropAdminClient();
const { data } = await sb.from("shopify_products").select("shopify_product_id");
const known = new Set((data??[]).map((r:any)=>String(r.shopify_product_id)));
let cursor: string|null=null; const rows:any[]=[];
for(let i=0;i<40;i++){
 const d:any= await shopifyGraphql(c,`query($cursor:String){products(first:50,after:$cursor){pageInfo{hasNextPage endCursor} nodes{id title status variants(first:100){nodes{id price inventoryItem{unitCost{amount}}}}}}}`,{cursor});
 for(const n of d.products.nodes){ if(known.has(String(n.id))) continue;
   const vs=n.variants.nodes; const bad=vs.filter((v:any)=>Math.round(Number(v.price)*100)%100!==99);
   rows.push({t:n.title.slice(0,38),status:n.status,nv:vs.length,not99:bad.length,sample:bad[0]?.price??null,cost:vs[0]?.inventoryItem?.unitCost?.amount??null});
 }
 if(!d.products.pageInfo.hasNextPage) break; cursor=d.products.pageInfo.endCursor;
}
console.log(rows.length); console.table(rows);
