import { zendropAdminClient } from "../../src/lib/zendrop/client.server";
const sb = await zendropAdminClient();
const { data: jobs } = await sb.from("automation_jobs").select("job_key,enabled,schedule_cron,last_run_at,last_status").order("job_key");
for (const j of jobs??[]) console.log([j.job_key,j.enabled,j.schedule_cron,j.last_run_at,j.last_status].join(" | "));
const { data: r } = await sb.from("automation_runs").select("job_key,status,message,created_at").order("created_at",{ascending:false}).limit(200);
const seen=new Set(); for (const x of r??[]) { if(seen.has(x.job_key))continue; seen.add(x.job_key); console.log("LASTRUN", x.job_key, x.created_at, x.status, (x.message??"").slice(0,120)); }
