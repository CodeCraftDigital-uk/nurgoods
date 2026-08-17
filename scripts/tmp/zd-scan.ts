import { callAction } from "../../src/lib/zendrop/client.server";
const a = (n: string) => ({ name: n, description: "", inputSchema: {}, kind: "read" as const });
const items: any[] = [];
for (let page = 1; page <= 10; page++) {
  const r = await callAction(a("get_my_products"), { store_id: 3493831, page, limit: 50 });
  const list = r?.items ?? [];
  items.push(...list);
  if (items.length >= (r?.total ?? 0) || list.length === 0) break;
}
const byStatus: Record<string, number> = {};
for (const i of items) byStatus[i.import_status] = (byStatus[i.import_status] ?? 0) + 1;
console.log("total", items.length, byStatus);
console.log("with store_product_id", items.filter((i) => i.store_product_id).length);
await Bun.write("scripts/tmp/my-products.json", JSON.stringify(items, null, 1));
console.log("=== shipping estimate sample");
console.log(JSON.stringify(await callAction(a("get_catalog_shipping_estimate"), { product_id: items[0].product_id, country_code: "gb" }), null, 2).slice(0, 3000));
