import { discoverActions, callAction } from "../../src/lib/zendrop/client.server";
const actions = await discoverActions();
const A = (n:string)=>actions.find((a:any)=>a.name===n)!;
console.log("### get_my_product(61753274)\n", JSON.stringify(await callAction(A("get_my_product"), { import_list_id: 61753274 }),null,1).slice(0,7000));
console.log("### inventory(61753274)\n", JSON.stringify(await callAction(A("get_my_product_inventory"), { import_list_id: 61753274 }),null,1).slice(0,3000));
