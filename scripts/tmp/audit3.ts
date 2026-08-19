import { zendropAdminClient } from "../../src/lib/zendrop/client.server";
const sb = await zendropAdminClient();
const { data: jobs } = await sb.from("automation_jobs").select("*").order("job_key");
console.log(JSON.stringify(jobs,null,1).slice(0,4000));
const { data: r } = await sb.from("automation_runs").select("job_key,status,message,created_at").in("job_key",["supplier_product_refresh","zendrop_sourcing","zendrop_sourcing_worker"]).order("created_at",{ascending:false}).limit(10);
console.log("SUPPLIER/SOURCING RUNS", JSON.stringify(r,null,1));
