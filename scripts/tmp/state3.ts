import { supabaseAdmin as db } from "@/integrations/supabase/client.server";
const r = await db.from("automation_jobs").select("*").limit(1);
console.log(Object.keys((r.data as any[])[0]));
const s = await db.from("integration_settings").select("*").limit(3);
console.log("settings_cols", Object.keys(((s.data as any[])[0])??{}), s.error?.message);
