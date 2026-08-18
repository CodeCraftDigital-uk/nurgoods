import { callAction, loadCapabilityMap, unwrapContent } from "@/lib/zendrop/client.server";
const roles = await loadCapabilityMap();
console.log("stores_list role:", roles.stores_list?.actionName ?? null);
const raw = await callAction(roles.stores_list!, {});
const un = unwrapContent(raw);
console.log("typeof", Array.isArray(un) ? "array" : typeof un, "keys:", un && !Array.isArray(un) ? Object.keys(un) : null);
console.log(JSON.stringify(un).slice(0, 1200));
