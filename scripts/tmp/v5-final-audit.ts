/** Read-only final audit for the authorized v5 repair and activation. */
import { supabaseAdmin as db } from "@/integrations/supabase/client.server";
import { intakeCredentials, shopifyGraphql } from "@/lib/services/shopify.server";
import { PRICING_FORMULA_VERSION } from "@/lib/pricing/authority.server";

const QUERY = `query($cursor: String) {
  products(first: 50, after: $cursor, sortKey: ID) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title status onlineStoreUrl
      resourcePublicationsV2(first: 25) { nodes { isPublished publication { name } } }
      variants(first: 100) { nodes { id title price compareAtPrice inventoryItem { unitCost { amount currencyCode } } } }
    }
  }
}`;

const credentials = await intakeCredentials();
const products: any[] = [];
let cursor: string | null = null;
for (;;) {
  const data: any = await shopifyGraphql(credentials, QUERY, { cursor });
  products.push(...(data?.products?.nodes ?? []));
  if (!data?.products?.pageInfo?.hasNextPage) break;
  cursor = data.products.pageInfo.endCursor;
}

const statuses: Record<string, number> = {};
const publications: Record<string, number> = {};
let pos = 0;
let activePublicationDrift = 0;
for (const product of products) {
  statuses[product.status] = (statuses[product.status] ?? 0) + 1;
  if (product.status !== "ACTIVE") continue;
  const names = (product.resourcePublicationsV2?.nodes ?? [])
    .filter((row: any) => row.isPublished)
    .map((row: any) => String(row.publication?.name ?? ""));
  for (const name of names) publications[name] = (publications[name] ?? 0) + 1;
  if (names.some((name: string) => /point of sale/i.test(name))) pos += 1;
  if (
    !names.some((name: string) => name === "Online Store") ||
    !names.some((name: string) => name === "Shop") ||
    !names.some((name: string) => /headless/i.test(name))
  ) activePublicationDrift += 1;
}

const authority: any[] = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from("product_price_authority")
    .select("shopify_product_id, shopify_variant_id, expected_price, observed_shopify_price, push_state, hold_reason, formula_version")
    .range(from, from + 999);
  if (error) throw error;
  authority.push(...(data ?? []));
  if ((data ?? []).length < 1000) break;
}
const activeIds = new Set(products.filter((product) => product.status === "ACTIVE").map((product) => String(product.id)));
let priceMismatches = 0;
let nonCharm = 0;
let held = 0;
let failed = 0;
let drifted = 0;
let legacy = 0;
let activeBlocked = 0;
for (const row of authority) {
  const expected = row.expected_price === null ? null : Number(row.expected_price);
  const observed = row.observed_shopify_price === null ? null : Number(row.observed_shopify_price);
  if (row.formula_version !== PRICING_FORMULA_VERSION) legacy += 1;
  if (row.hold_reason || row.push_state === "held") held += 1;
  if (row.push_state === "failed") failed += 1;
  if (row.push_state === "drifted") drifted += 1;
  if (expected !== null && (observed === null || Math.abs(expected - observed) >= 0.005)) priceMismatches += 1;
  if (expected !== null && Math.round(expected * 100) % 100 !== 99) nonCharm += 1;
  if (activeIds.has(String(row.shopify_product_id)) && (row.hold_reason || row.push_state === "held" || row.push_state === "failed" || row.push_state === "drifted")) activeBlocked += 1;
}

const { data: lifecycle } = await db
  .from("product_pricing_lifecycle")
  .select("shopify_product_id, status, reason, formula_version");
const draftIds = new Set(products.filter((product) => product.status === "DRAFT").map((product) => String(product.id)));
const draftReasons: Record<string, number> = {};
for (const row of (lifecycle ?? []) as any[]) {
  if (!draftIds.has(String(row.shopify_product_id))) continue;
  const reason = String(row.reason ?? row.status ?? "No lifecycle reason recorded");
  draftReasons[reason] = (draftReasons[reason] ?? 0) + 1;
}

const { data: policy } = await db
  .from("pricing_formula_policy")
  .select("formula_version, activation_enabled")
  .eq("id", true)
  .maybeSingle();
const { count: snapshotProducts } = await db
  .from("storefront_snapshot")
  .select("id", { count: "exact", head: true });

const samples = products
  .filter((product) => /marinade injector/i.test(product.title) || /tropical sunburn/i.test(product.title))
  .map((product) => ({
    title: product.title,
    status: product.status,
    onlineStoreUrl: product.onlineStoreUrl,
    channels: product.resourcePublicationsV2.nodes
      .filter((row: any) => row.isPublished)
      .map((row: any) => row.publication.name),
    variants: product.variants.nodes.map((variant: any) => ({
      title: variant.title,
      price: Number(variant.price),
      compareAtPrice: variant.compareAtPrice === null ? null : Number(variant.compareAtPrice),
      unitCost: variant.inventoryItem?.unitCost?.amount === undefined ? null : Number(variant.inventoryItem.unitCost.amount),
    })),
  }));

console.log(JSON.stringify({
  products: products.length,
  statuses,
  publications,
  pos,
  activePublicationDrift,
  authority: { rows: authority.length, priceMismatches, nonCharm, held, failed, drifted, legacy, activeBlocked },
  draftReasons,
  snapshotProducts,
  policy,
  samples,
}, null, 2));