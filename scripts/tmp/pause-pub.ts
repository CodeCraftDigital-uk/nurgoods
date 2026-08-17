import { zendropAdminClient } from "../../src/lib/zendrop/client.server";
const sb = await zendropAdminClient();
const { data } = await sb.from("zendrop_sourcing_rules").select("*").limit(1).maybeSingle();
console.log(JSON.stringify(data, null, 1));
const { data: jobs } = await sb.from("automation_jobs").select("job_key,enabled,schedule,last_status");
console.log(JSON.stringify(jobs, null, 1));
