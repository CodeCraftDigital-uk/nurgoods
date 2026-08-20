import { supabaseAdmin as db } from "@/integrations/supabase/client.server";
const u = await db.auth.admin.listUsers();
console.log(JSON.stringify(u.data?.users.map(x => ({ id: x.id, email: x.email, last: x.last_sign_in_at })) ?? u.error));
const r = await db.rpc("has_role", { _user_id: "235b555f-0303-4dcb-8fa6-3db546fdae1e", _role: "admin" as never });
console.log("has_role", JSON.stringify(r.data ?? r.error));
