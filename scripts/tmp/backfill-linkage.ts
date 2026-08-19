import { recoverSupplierLinkage } from "@/lib/pricing/linkage.server";
const r = await recoverSupplierLinkage();
console.log(JSON.stringify(r, null, 2));
