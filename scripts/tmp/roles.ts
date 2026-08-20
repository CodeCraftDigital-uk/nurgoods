import { supabaseAdmin as db } from "@/integrations/supabase/client.server";
const q = `select p.proname, coalesce(array_to_string(p.proacl,','),'(default)') acl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='has_role'`;
const r = await db.rpc("exec_sql" as never, { sql: q } as never);
console.log(JSON.stringify(r.data ?? r.error));
