import { intakeCredentials, shopifyGraphql } from "../../src/lib/services/shopify.server";
import { zendropAdminClient } from "../../src/lib/zendrop/client.server";
const c = await intakeCredentials(); const sb = await zendropAdminClient();
const known = new Set<string>();
for(let off=0;off<3000;off+=1000){const {data}=await sb.from("shopify_product_variants").select("shopify_variant_id").range(off,off+999); (data??[]).forEach((r:any)=>known.add(String(r.shopify_variant_id))); if(!data||data.length<1000)break;}
let cursor:string|null=null; const miss:Record<string,number>={};
for(let i=0;i<40;i++){
 const d:any=await shopifyGraphql(c,`query($cursor:String){products(first:50,after:$cursor){pageInfo{hasNextPage endCursor} nodes{id title variants(first:100){pageInfo{hasNextPage} nodes{id}}}}}`,{cursor});
 for(const p of d.products.nodes){ for(const v of p.variants.nodes){ if(!known.has(String(v.id))) miss[p.title.slice(0,40)]=(miss[p.title.slice(0,40)]??0)+1; } }
 if(!d.products.pageInfo.hasNextPage)break; cursor=d.products.pageInfo.endCursor;
}
console.log("mirrored",known.size); console.log(miss);
