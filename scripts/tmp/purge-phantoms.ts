/** Removes mirror rows for products the store no longer holds. */
const { zendropAdminClient } = await import("@/lib/zendrop/client.server");
const { fetchLiveCataloguePage } = await import("@/lib/pricing/catalogue-reconcile.server");
const { purgeLocalRecords } = await import("@/lib/catalogue/deletion.server");
const s = await zendropAdminClient();
const live = new Set<string>();
let cursor: string | null = null;
for (let i = 0; i < 40; i += 1) {
  const page = await fetchLiveCataloguePage(cursor);
  page.products.forEach((p) => live.add(p.shopifyProductId));
  cursor = page.cursor;
  if (!page.hasNextPage) break;
}
const { data: rows } = await s.from("shopify_products").select("id, shopify_product_id, status, title").limit(2000);
const phantoms = ((rows ?? []) as any[]).filter((r) => !live.has(r.shopify_product_id));
console.log("live", live.size, "mirror", (rows ?? []).length, "phantoms", phantoms.length);
let done = 0; const failed: string[] = [];
for (const row of phantoms) {
  const cleaned = await purgeLocalRecords(s, { shopifyProductId: row.shopify_product_id, productId: row.id });
  if (cleaned.includes("shopify_products")) done += 1; else failed.push(row.shopify_product_id);
}
console.log(JSON.stringify({ done, failed }));
