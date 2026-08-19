import { auditSellability } from "../../src/lib/intake/sellability.server";
const a = await auditSellability();
console.log(JSON.stringify({ active: a.activeProducts, sellable: a.sellable, held: a.held, reasons: a.reasonCounts }, null, 2));
