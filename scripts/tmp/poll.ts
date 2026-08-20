import { supabaseAdmin as db } from "@/integrations/supabase/client.server";
for (let i=0;i<10;i++){
  const r = await db.from("automation_jobs").select("job_key,last_status,last_run_at,last_result").in("job_key",["product_intake_worker","supplier_sourcing_hourly"]);
  console.log(new Date().toISOString().slice(11,19), (r.data as any[]).map(j=>`${j.job_key}=${j.last_status}@${String(j.last_run_at).slice(11,19)}`).join(" | "));
  if ((r.data as any[]).every(j=>j.last_status!=="running")) { console.log(JSON.stringify((r.data as any[]).map(j=>j.last_result))); break; }
  await new Promise(r=>setTimeout(r,15000));
}
