import { supabaseAdmin as db } from "@/integrations/supabase/client.server";
const r = await db.from("automation_jobs").select("job_key,enabled,schedule,last_status,last_run_at").order("job_key");
console.log(JSON.stringify(r.data ?? r.error, null, 0));
