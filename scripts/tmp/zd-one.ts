import { callAction } from "../../src/lib/zendrop/client.server";
const a = (n: string) => ({ name: n, description: "", inputSchema: {}, kind: "read" as const });
console.log("=== get_my_product");
console.log(JSON.stringify(await callAction(a("get_my_product"), { import_list_id: 61552446 }), null, 2).slice(0, 4000));
console.log("=== get_catalog_product");
console.log(JSON.stringify(await callAction(a("get_catalog_product"), { product_id: 2917370 }), null, 2).slice(0, 5000));
