/** Final acceptance check: status, channels and canonical price parity, live. */
const { intakeCredentials, shopifyGraphql } = await import("@/lib/services/shopify.server");
const { zendropAdminClient } = await import("@/lib/zendrop/client.server");
const creds = await intakeCredentials();
const s = await zendropAdminClient();
const Q = `query($cursor:String){products(first:50,after:$cursor,sortKey:ID){pageInfo{hasNextPage endCursor}
 nodes{id status resourcePublicationsV2(first:25){nodes{isPublished publication{name}}} variants(first:100){nodes{id price compareAtPrice}}}}}`;
const required = ["Online Store", "Shop", "Nur Goods Headless Store"];
let cursor: string | null = null;
const stats = { total: 0, active: 0, draft: 0, channelOk: 0, channelBad: [] as string[], pos: [] as string[], nonCharm: [] as string[], compareAt: [] as string[] };
const variantPrices = new Map<string, number>();
for (let i = 0; i < 40; i += 1) {
  const d: any = await shopifyGraphql(creds, Q, { cursor });
  for (const p of d.products.nodes) {
    stats.total += 1;
    const active = String(p.status).toLowerCase() === "active";
    active ? (stats.active += 1) : (stats.draft += 1);
    const pubs = new Map<string, boolean>(p.resourcePublicationsV2.nodes.map((n: any) => [n.publication.name, n.isPublished]));
    if (active) {
      const ok = required.every((r) => pubs.get(r) === true);
      ok ? (stats.channelOk += 1) : stats.channelBad.push(`${p.id} ${JSON.stringify([...pubs])}`);
      for (const [name, on] of pubs) if (/point of sale/i.test(name) && on) stats.pos.push(p.id);
      for (const v of p.variants.nodes) {
        const price = Number(v.price);
        variantPrices.set(v.id, price);
        if (Math.round(price * 100) % 100 !== 99) stats.nonCharm.push(`${v.id} ${price}`);
        if (v.compareAtPrice !== null) stats.compareAt.push(v.id);
      }
    } else {
      for (const [name, on] of pubs) if (on) stats.channelBad.push(`DRAFT-PUBLISHED ${p.id} ${name}`);
    }
  }
  cursor = d.products.pageInfo.endCursor;
  if (!d.products.pageInfo.hasNextPage) break;
}
const { data: authority } = await s.from("product_price_authority").select("shopify_variant_id, expected_price").limit(20000);
let matched = 0; const drift: string[] = [];
for (const row of ((authority ?? []) as any[])) {
  const live = variantPrices.get(row.shopify_variant_id);
  if (live === undefined || row.expected_price === null) continue;
  if (Math.abs(live - Number(row.expected_price)) < 0.005) matched += 1;
  else drift.push(`${row.shopify_variant_id} live ${live} expected ${row.expected_price}`);
}
console.log(JSON.stringify({ ...stats, channelBad: stats.channelBad.slice(0, 5), nonCharm: stats.nonCharm.slice(0, 5), nonCharmCount: stats.nonCharm.length, compareAtCount: stats.compareAt.length, parityMatched: matched, drift: drift.slice(0, 5), driftCount: drift.length }, null, 2));
