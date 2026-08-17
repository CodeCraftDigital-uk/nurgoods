import { callAction } from "../../src/lib/zendrop/client.server";
import { zendropAdminClient } from "../../src/lib/zendrop/client.server";
const a = (n: string) => ({ name: n, description: "", inputSchema: {}, kind: "read" as const });
const sb = await zendropAdminClient();
const { data } = await sb.from("zendrop_capabilities").select("action_name,input_schema").in("action_name", ["get_catalog_shipping_estimate","get_catalog_product","get_my_product"]);
console.log(JSON.stringify(data, null, 1).slice(0, 4000));
console.log("=== in-store my_product");
console.log(JSON.stringify(await callAction(a("get_my_product"), { import_list_id: 61565229 }), null, 2).slice(0, 3000));
