import { zendropAdminClient } from "../../src/lib/zendrop/client.server";
const sb = await zendropAdminClient();
const r = await sb.from("automation_jobs").select("job_key,enabled,schedule,last_status,last_run_at");
console.log(JSON.stringify(r.error ?? r.data, null, 1));
