import { intakeCredentials, shopifyGraphql } from "../../src/lib/services/shopify.server";
const c = await intakeCredentials();
let cursor: string | null = null; let prods = 0; let vars = 0; const big: string[] = [];
for (let i=0;i<40;i++){
  const d: any = await shopifyGraphql(c, `query($cursor:String){ products(first:100, after:$cursor){ pageInfo{hasNextPage endCursor} nodes{ id title status variantsCount{count} } } }`, { cursor });
  const conn = d?.products; for (const n of conn.nodes){ prods++; const v=n.variantsCount?.count??0; vars+=v; if(v>100) big.push(`${n.title.slice(0,40)} ${v} ${n.status}`);}
  if(!conn.pageInfo.hasNextPage) break; cursor = conn.pageInfo.endCursor;
}
console.log({prods, vars, big});
