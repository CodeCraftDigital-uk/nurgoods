/** Re-runs settlement for items blocked by the earlier store 404 handling gap. */
const { zendropAdminClient } = await import("@/lib/zendrop/client.server");
const { purgeLocalRecords } = await import("@/lib/catalogue/deletion.server");
const s = await zendropAdminClient();
const runId = "a4d166a7-d8c8-467b-9eb9-94b692503756";
const { data } = await s.from("catalogue_repair_items").select("id, shopify_product_id, reason").eq("run_id", runId).eq("reason_code", "store_refused");
for (const item of ((data ?? []) as any[])) {
  const { data: mirror } = await s.from("shopify_products").select("id").eq("shopify_product_id", item.shopify_product_id).maybeSingle();
  const cleaned = await purgeLocalRecords(s, { shopifyProductId: item.shopify_product_id, productId: (mirror as any)?.id ?? null });
  await s.from("catalogue_repair_items").update({
    decision: "purged", reason_code: "phantom", blocked: false,
    reason: "The product was already absent from the store, so its local records were cleared.",
    status_after: "absent_from_store",
  } as never).eq("id", item.id);
  console.log(item.shopify_product_id, JSON.stringify(cleaned));
}
