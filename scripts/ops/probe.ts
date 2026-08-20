import { supabaseAdmin as db } from "@/integrations/supabase/client.server";
const t=Date.now();
const a = await db.from("storefront_snapshot").select("product_id",{count:"exact",head:true});
console.log("snapshot_count", a.count, a.error?.message, Date.now()-t);
const m = await db.from("storefront_snapshot_meta").select("*");
console.log("meta", JSON.stringify(m.data??m.error));
const p = await db.from("shopify_products").select("id",{count:"exact",head:true}).eq("status","active");
console.log("active", p.count, p.error?.message, Date.now()-t);
