/** Re-evaluates the one remaining draft that could not be deleted. */
const { zendropAdminClient } = await import("@/lib/zendrop/client.server");
const s = await zendropAdminClient();
const runId = "a4d166a7-d8c8-467b-9eb9-94b692503756";
const { data } = await s.from("catalogue_repair_items").select("shopify_product_id, reason, reason_code, evidence").eq("run_id", runId).eq("reason_code", "dependency");
console.log(JSON.stringify(data, null, 2).slice(0, 2500));
