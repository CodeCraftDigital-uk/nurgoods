import { runSupplierProductRefresh } from "@/lib/zendrop/supplier-refresh.server";
const r = await runSupplierProductRefresh({ batchSize: 3, dryRun: true });
console.log(r.message);
for (const i of r.items) console.log(i.supplierProductId, i.state, "| stock", i.inventory, "| landed", i.landedCost, "|", i.reason.slice(0,120));
