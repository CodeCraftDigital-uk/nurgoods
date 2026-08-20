import { supabaseAdmin as db } from "@/integrations/supabase/client.server";
const r = await db.from("user_roles").select("user_id, role");
console.log("roles", JSON.stringify(r.data ?? r.error));
