import { supabaseAdmin } from "../../src/integrations/supabase/client.server";
const key = `supplier_sourcing_hourly:${new Date().toISOString().slice(0,13)}`;
const { error, count } = await (supabaseAdmin as any).from("automation_runs").delete({ count: "exact" }).eq("run_key", key);
console.log("cleared", count, error?.message ?? "");
