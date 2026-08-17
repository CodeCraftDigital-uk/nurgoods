import { intakeCredentials, shopifyGraphql } from "../../src/lib/services/shopify.server";
const c = await intakeCredentials();
let cursor: string|null=null; let n=0, bad=0; const offenders:any[]=[];
for(let i=0;i<40;i++){
 const d:any= await shopifyGraphql(c,`query($cursor:String){products(first:50,after:$cursor,query:"status:active"){pageInfo{hasNextPage endCursor} nodes{id title status variants(first:100){nodes{id price}}}}}`,{cursor});
 for(const p of d.products.nodes){ for(const v of p.variants.nodes){ n++; if(Math.round(Number(v.price)*100)%100!==99){bad++; offenders.push({t:p.title.slice(0,34),id:v.id.split("/").pop(),price:v.price});} } }
 if(!d.products.pageInfo.hasNextPage) break; cursor=d.products.pageInfo.endCursor;
}
console.log({activeVariants:n, notEnding99:bad, distinctProducts:new Set(offenders.map(o=>o.t)).size});
console.table(offenders.slice(0,15));
