import { supabaseAdmin } from "../../src/integrations/supabase/client.server";
const s = supabaseAdmin as any;
await s.from("zendrop_sourcing_rules").update({ enabled: false, continuous_sourcing: false }).eq("id","default");
const { data } = await s.from("zendrop_sourcing_rules").select("enabled, continuous_sourcing").eq("id","default").maybeSingle();
console.log(JSON.stringify(data));
