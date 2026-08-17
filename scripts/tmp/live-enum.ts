import { intakeCredentials, shopifyGraphql } from "../../src/lib/services/shopify.server";
const creds = await intakeCredentials();
const Q = `query($c:String){ products(first:50, after:$c, query:"status:active"){ pageInfo{hasNextPage endCursor} nodes{ id title handle status totalInventory
  variants(first:100){ pageInfo{hasNextPage} nodes{ id title price compareAtPrice availableForSale inventoryItem{ unitCost{amount currencyCode} } } } } } }`;
let c: string | null = null; const out: any[] = [];
while (true) {
  const d: any = await shopifyGraphql(creds, Q, { c });
  out.push(...d.products.nodes);
  if (!d.products.pageInfo.hasNextPage) break;
  c = d.products.pageInfo.endCursor;
}
const bad: any[] = []; let variants = 0; let overflow: string[] = [];
for (const p of out) {
  if (p.variants.pageInfo.hasNextPage) overflow.push(p.title);
  for (const v of p.variants.nodes) {
    variants++;
    const price = Number(v.price);
    const pence = Math.round(price * 100) % 100;
    if (pence !== 99) bad.push({ product: p.title, pid: p.id, vid: v.id, handle: p.handle, price, cost: v.inventoryItem?.unitCost?.amount ?? null, cur: v.inventoryItem?.unitCost?.currencyCode ?? null, avail: v.availableForSale });
  }
}
console.log("active products", out.length, "active variants", variants, "non99", bad.length, "variantOverflow", overflow);
await Bun.write("scripts/tmp/live-active.json", JSON.stringify({ products: out, bad }, null, 2));
const byProduct = new Map<string, any[]>();
for (const b of bad) { const k = b.product; byProduct.set(k, [...(byProduct.get(k) ?? []), b]); }
for (const [k, vs] of byProduct) console.log(k, "|", vs.length, "| prices", [...new Set(vs.map(v=>v.price))].slice(0,6).join(","), "| cost", vs[0].cost, vs[0].cur);
