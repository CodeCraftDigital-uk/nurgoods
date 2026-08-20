import { supabaseAdmin as db } from "@/integrations/supabase/client.server";
const r = await db.from("automation_jobs").select("job_key,enabled,last_status,last_run_at,last_result").order("last_run_at",{ascending:false});
for (const j of (r.data??[]) as any[]) {
  const msg = typeof j.last_result === "object" ? (j.last_result?.message ?? j.last_result?.error ?? "") : String(j.last_result ?? "");
  console.log(String(j.job_key).padEnd(34), String(j.last_status).padEnd(9), String(j.last_run_at).slice(0,19), String(msg).slice(0,80));
}
const s = await db.from("integration_settings").select("key,value").in("key",["auto_fulfilment_enabled","allow_supplier_credit","order_fulfilment_paused","publication_include_online_store","target_catalogue_size"]);
console.log("settings", JSON.stringify(s.data), s.error?.message);
