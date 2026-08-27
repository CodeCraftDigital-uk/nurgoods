/** Clears mirror rows for products the repair run already deleted from the store. */
const { zendropAdminClient } = await import("@/lib/zendrop/client.server");
const { purgeLocalRecords } = await import("@/lib/catalogue/deletion.server");
const s = await zendropAdminClient();
const runId = "a4d166a7-d8c8-467b-9eb9-94b692503756";
const { data: items } = await s.from("catalogue_repair_items").select("shopify_product_id").eq("run_id", runId).eq("decision", "delete");
const ids = new Set(((items ?? []) as any[]).map((i) => i.shopify_product_id));
const { data: rows } = await s.from("shopify_products").select("id, shopify_product_id").limit(2000);
const targets = ((rows ?? []) as any[]).filter((r) => ids.has(r.shopify_product_id));
console.log("orphan mirror rows:", targets.length);
let done = 0; const failed: string[] = [];
for (const row of targets) {
  const cleaned = await purgeLocalRecords(s, { shopifyProductId: row.shopify_product_id, productId: row.id });
  if (cleaned.includes("shopify_products")) done += 1; else failed.push(row.shopify_product_id);
}
console.log(JSON.stringify({ done, failed: failed.length, sample: failed.slice(0, 5) }));
