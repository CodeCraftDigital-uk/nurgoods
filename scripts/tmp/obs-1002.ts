import { zendropSupplierPort } from "../../src/lib/commerce/supplier.server";
const storeId = 3493831;
const o = await zendropSupplierPort.getOrder({ storeId, orderId: 44692541 });
console.log("ORDER", JSON.stringify(o, null, 2).slice(0, 3000));
const list = await zendropSupplierPort.listOrders({ storeId, search: "#1002" });
console.log("LIST", JSON.stringify(list, null, 2).slice(0, 2000));
