import { supabaseAdmin as db } from "../../src/integrations/supabase/client.server";
const o = await db.from("commerce_orders").select("*");
for (const r of (o.data ?? []) as any[]) {
  console.log(JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k,v]) => v !== null && v !== "" ))));
}
const c = await db.from("zendrop_import_candidates").select("id,status,zendrop_product_id,product_id").limit(20);
console.log("CAND", c.data?.length, JSON.stringify(c.error));
const runs = await db.from("automation_runs").select("job_key,status,message,finished_at").eq("job_key","supplier_sourcing_hourly").order("started_at",{ascending:false}).limit(3);
console.log("RUNS", JSON.stringify(runs.data));
