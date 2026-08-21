import { zendropAdminClient } from "../../src/lib/zendrop/client.server";
const s = await zendropAdminClient();
const { data, error } = await s.rpc("refresh_storefront_snapshot" as never);
console.log("listings", data, error?.message);
const { data: stats } = await s.rpc("pricing_lifecycle_stats" as never);
console.log(JSON.stringify(stats).slice(0, 700));
