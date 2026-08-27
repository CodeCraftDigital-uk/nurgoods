const { zendropAdminClient } = await import("@/lib/zendrop/client.server");
const s = await zendropAdminClient();
const { error } = await s.from("shopify_products").delete().eq("id", "91fc0945-a1bc-46ea-a723-24d3c8a37e3d");
console.log(JSON.stringify(error, null, 2));
