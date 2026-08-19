import { zendropAdminClient } from "../../src/lib/zendrop/client.server";
const sb = await zendropAdminClient();
const { data: links } = await sb.from("product_supplier_links").select("id,shopify_product_id,supplier_product_id,supplier_import_list_id,variant_map,sync_state,last_supplier_sync_at").limit(500);
let mapped=0, empty=0, withIL=0;
for (const l of links??[]) { const vm=l.variant_map; if (vm && (Array.isArray(vm)?vm.length:Object.keys(vm).length)>0) mapped++; else empty++; if (l.supplier_import_list_id) withIL++; }
console.log({total:links?.length, variantMapped:mapped, variantMapEmpty:empty, withImportListId:withIL});
console.log("sample variant_map", JSON.stringify((links??[]).find((l:any)=>l.variant_map)?.variant_map)?.slice(0,400));
const byState:Record<string,number>={}; for(const l of links??[]) byState[l.sync_state??"null"]=(byState[l.sync_state??"null"]??0)+1;
console.log("sync_state", byState);
console.log("oldest sync", (links??[]).map((l:any)=>l.last_supplier_sync_at).sort()[0]);
const { data: runs } = await sb.from("automation_runs").select("*").order("created_at",{ascending:false}).limit(8);
console.log("recent runs", JSON.stringify(runs,null,1).slice(0,2500));
const { data: jobs } = await sb.from("automation_jobs").select("*");
console.log("jobs", JSON.stringify(jobs?.map((j:any)=>({k:j.key??j.id,en:j.enabled,last:j.last_run_at,next:j.next_run_at}))));
