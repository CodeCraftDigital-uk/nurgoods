import { supabaseAdmin as db } from "@/integrations/supabase/client.server";
const r = await db.from("automation_jobs").select("*").limit(50);
console.log("err", r.error?.message);
for (const j of (r.data??[]) as any[]) console.log(j.job_key, j.enabled, j.status ?? j.state ?? "", j.last_run_at, j.last_run_status ?? "", String(j.last_error??"").slice(0,80));
