import { callAction, loadCapabilityMap, unwrapContent } from "../../src/lib/zendrop/client.server";
const map = await loadCapabilityMap();
const res = await callAction(map["order_get"] as any, { store_id: 3493831, order_id: 44692714 });
console.log(JSON.stringify(unwrapContent(res), null, 2));
