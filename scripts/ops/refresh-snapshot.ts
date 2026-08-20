import { supabaseAdmin as db } from "@/integrations/supabase/client.server";
const t = Date.now();
const r = await db.rpc("refresh_storefront_snapshot" as never);
console.log("refresh_ms", Date.now() - t, JSON.stringify(r.data ?? r.error));
const m = await db.from("storefront_snapshot_meta").select("*");
console.log("meta", JSON.stringify(m.data ?? m.error));
