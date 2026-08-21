import { supabaseAdmin as db } from "@/integrations/supabase/client.server";
import { intakeCredentials, shopifyGraphql } from "@/lib/services/shopify.server";

const creds = await intakeCredentials();

const QUERY = `query($cursor: String) {
  products(first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title status productType tags
      publications: resourcePublicationsV2(first: 10) { nodes { isPublished publication { name } } }
      variants(first: 100) {
        nodes { id title price inventoryItem { unitCost { amount } } }
      }
    }
  }
}`;

type V = { id: string; title: string; price: string; inventoryItem?: { unitCost?: { amount: string } | null } | null };
type P = {
  id: string; title: string; status: string; productType: string | null; tags: string[];
  publications: { nodes: { isPublished: boolean; publication: { name: string } }[] };
  variants: { nodes: V[] };
};

function expectedV4(cost: number): number {
  const raw = (cost * 1.6 + 0.25) / 0.98;
  const pence = Math.round(raw * 100);
  let target = Math.ceil((pence - 99) / 100) * 100 + 99;
  if (target < pence) target += 100;
  return target / 100;
}

const products: P[] = [];
let cursor: string | null = null;
for (;;) {
  const r: any = await shopifyGraphql(creds, QUERY, { cursor });
  products.push(...r.products.nodes);
  if (!r.products.pageInfo.hasNextPage) break;
  cursor = r.products.pageInfo.endCursor;
}

const byStatus: Record<string, number> = {};
for (const p of products) byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;

let variants = 0, missingCost = 0, exact = 0, drift = 0, nonCharm = 0;
const driftExamples: string[] = [];
for (const p of products) {
  for (const v of p.variants.nodes) {
    variants += 1;
    const price = Number(v.price);
    if (Math.round(price * 100) % 100 !== 99) nonCharm += 1;
    const costRaw = v.inventoryItem?.unitCost?.amount;
    const cost = costRaw === undefined || costRaw === null ? NaN : Number(costRaw);
    if (!Number.isFinite(cost) || cost <= 0) { missingCost += 1; continue; }
    const exp = expectedV4(cost);
    if (Math.abs(exp - price) < 0.005) exact += 1;
    else {
      drift += 1;
      if (driftExamples.length < 15) driftExamples.push(`${p.status} ${p.title} / ${v.title}: cost ${cost.toFixed(2)} store ${price.toFixed(2)} expected ${exp.toFixed(2)}`);
    }
  }
}

console.log("PRODUCT_STATUS", JSON.stringify(byStatus), "total", products.length);
console.log("VARIANTS", JSON.stringify({ variants, missingCost, exact, drift, nonCharm }));
console.log("DRIFT_EXAMPLES\n" + driftExamples.join("\n"));

// t-shirt
const shirts = products.filter((p) => /tropical/i.test(p.title));
for (const p of shirts) {
  console.log("TSHIRT", p.title, p.status);
  for (const v of p.variants.nodes.slice(0, 60)) {
    const c = Number(v.inventoryItem?.unitCost?.amount ?? NaN);
    console.log("  ", v.title, "cost", c, "price", v.price, "expected", Number.isFinite(c) ? expectedV4(c).toFixed(2) : "n/a");
  }
}

// clothing analysis
const isClothing = (p: P) =>
  /shirt|tee|hood|apparel|cloth|dress|jacket|trouser|pant|sock|sweat|jumper|coat|skirt|short|legging|blouse|top\b|garment|wear/i.test(
    `${p.title} ${p.productType ?? ""} ${(p.tags ?? []).join(" ")}`,
  );
const clothing = products
  .filter((p) => p.status === "ACTIVE" && isClothing(p))
  .map((p) => {
    const top = [...p.variants.nodes].sort((a, b) => Number(b.price) - Number(a.price))[0];
    const cost = Number(top?.inventoryItem?.unitCost?.amount ?? NaN);
    const price = Number(top?.price ?? NaN);
    return { title: p.title, type: p.productType, cost, price, exp: Number.isFinite(cost) ? expectedV4(cost) : NaN };
  })
  .sort((a, b) => b.price - a.price)
  .slice(0, 15);
console.log("CLOTHING_TOP15");
for (const c of clothing) {
  const markup = Number.isFinite(c.cost) && c.cost > 0 ? (c.price / c.cost).toFixed(2) + "x" : "n/a";
  console.log(`  ${c.price.toFixed(2)} | cost ${Number.isFinite(c.cost) ? c.cost.toFixed(2) : "none"} | expected ${Number.isFinite(c.exp) ? c.exp.toFixed(2) : "n/a"} | markup ${markup} | ${c.title}`);
}

// publication parity for ACTIVE
const chanCount: Record<string, number> = {};
let posOn = 0;
const missing: string[] = [];
const active = products.filter((p) => p.status === "ACTIVE");
for (const p of active) {
  const on = p.publications.nodes.filter((n) => n.isPublished).map((n) => n.publication.name);
  for (const c of on) chanCount[c] = (chanCount[c] ?? 0) + 1;
  if (on.some((c) => /point of sale/i.test(c))) posOn += 1;
  const hasOnline = on.some((c) => /online store/i.test(c));
  const hasShop = on.some((c) => /^shop$/i.test(c));
  const hasHeadless = on.some((c) => /headless/i.test(c));
  if (!(hasOnline && hasShop && hasHeadless) && missing.length < 10)
    missing.push(`${p.title}: ${on.join(", ") || "none"}`);
}
console.log("ACTIVE", active.length, "CHANNELS", JSON.stringify(chanCount), "POS_ON", posOn);
console.log("PARITY_GAPS_SAMPLE\n" + missing.join("\n"));

// local authority / lifecycle
const { data: auth } = await db.from("product_price_authority").select("formula_version").limit(20000);
const fv: Record<string, number> = {};
for (const r of (auth ?? []) as any[]) fv[r.formula_version] = (fv[r.formula_version] ?? 0) + 1;
console.log("AUTHORITY_FORMULA_VERSIONS", JSON.stringify(fv));
const { data: lc } = await db.from("product_pricing_lifecycle").select("state").limit(20000);
const st: Record<string, number> = {};
for (const r of (lc ?? []) as any[]) st[r.state] = (st[r.state] ?? 0) + 1;
console.log("LIFECYCLE_STATES", JSON.stringify(st));
const { count: snap } = await db.from("storefront_snapshot").select("*", { count: "exact", head: true });
console.log("SNAPSHOT_ROWS", snap);
