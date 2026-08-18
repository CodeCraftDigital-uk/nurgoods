import { zendropSupplierPort } from "@/lib/commerce/supplier.server";
const av = await zendropSupplierPort.available();
console.log("available:", JSON.stringify(av));
const storeId = await zendropSupplierPort.storeId();
console.log("storeId:", storeId);
if (storeId) {
  const orders = await zendropSupplierPort.listOrders({ storeId });
  console.log("order count:", orders.length);
  console.log(orders.slice(0,3).map(o => ({ id: o.id, status: o.status, lines: o.lines?.length ?? null })));
}
