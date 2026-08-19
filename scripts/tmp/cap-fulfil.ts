import { loadCapabilityMap } from "../../src/lib/zendrop/client.server";
const m = await loadCapabilityMap();
for (const k of ["order_fulfil","order_fulfilment_cost","order_fulfilment_operation"]) {
  const a: any = (m as any)[k];
  console.log("==", k, a?.name);
  console.log(a?.description);
  console.log(JSON.stringify(a?.inputSchema ?? a?.input_schema ?? {}, null, 1));
}
