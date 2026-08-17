import { callAction } from "../../src/lib/zendrop/client.server";
const a = { name: "get_my_products", description: "", inputSchema: {}, kind: "read" as const };
const res = await callAction(a, { store_id: 3493831, page: 1, limit: 3 });
console.log(JSON.stringify(res, null, 2).slice(0, 9000));
