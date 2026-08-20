import { supabaseAdmin as db } from "@/integrations/supabase/client.server";
for (const t of ["zendrop_pricing_settings","commerce_settings","automation_settings"]) {
  const r = await db.from(t as any).select("*").limit(2);
  if (!r.error) console.log(t, JSON.stringify(r.data));
}
const s = await db.from("integration_settings").select("key,value").ilike("key","%fulfil%");
console.log("fulfil keys", JSON.stringify(s.data));
