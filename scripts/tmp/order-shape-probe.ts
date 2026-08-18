import { callAction, loadCapabilityMap, unwrapContent } from "../../src/lib/zendrop/client.server";
const roles = await loadCapabilityMap();
console.log("roles:", Object.keys(roles).filter((k) => (roles as any)[k]));
if (!roles.stores_list) process.exit(0);
const stores = unwrapContent(await callAction(roles.stores_list, {}));
const list = Array.isArray(stores) ? stores : (stores?.stores ?? stores?.data ?? []);
console.log("store count:", list.length, "keys:", Object.keys(list[0] ?? {}));
const storeId = list[0]?.id;
if (!storeId || !roles.orders_list) process.exit(0);
const orders = unwrapContent(await callAction(roles.orders_list, { store_id: storeId }));
const rows = Array.isArray(orders) ? orders : (orders?.orders ?? orders?.data ?? orders?.results ?? []);
console.log("orders wrapper keys:", Array.isArray(orders) ? "array" : Object.keys(orders ?? {}));
console.log("order count:", rows.length);
if (rows.length === 0) process.exit(0);
console.log("order keys:", Object.keys(rows[0]));
if (roles.order_get) {
  const one = unwrapContent(await callAction(roles.order_get, { store_id: storeId, order_id: rows[0].id }));
  const body = one?.order ?? one?.data ?? one;
  console.log("get_order keys:", Object.keys(body ?? {}));
  for (const k of ["line_items","lineItems","items","order_items","order_line_items","products","variants"]) {
    if (Array.isArray(body?.[k])) console.log("LINES key:", k, "line keys:", Object.keys(body[k][0] ?? {}));
  }
}
