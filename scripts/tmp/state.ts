import { supabaseAdmin as db } from "@/integrations/supabase/client.server";
const { data: jobs } = await db.from("automation_jobs").select("job_key,enabled,state,last_run_at,last_status,last_error").order("job_key");
for (const j of (jobs??[]) as any[]) console.log(j.job_key, j.enabled, j.state ?? "", j.last_status ?? "", j.last_run_at ?? "", (j.last_error??"").slice(0,90));
const { data: s } = await db.from("integration_settings").select("key,value").in("key",["auto_fulfilment_enabled","allow_supplier_credit","order_fulfilment_paused","publication_include_online_store"]);
console.log("settings", JSON.stringify(s));
const { count } = await db.from("shopify_products").select("id",{count:"exact",head:true}).eq("status","active");
console.log("active_products", count);
