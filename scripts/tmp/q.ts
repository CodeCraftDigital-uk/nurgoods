import { supabaseAdmin as db } from "../../src/integrations/supabase/client.server";
async function t(name:string, f:()=>any){const s=Date.now();const r=await f();console.log(name, Date.now()-s, r.error?.message ?? (r.count ?? (r.data?.length)));}
await t("count", ()=>db.from("storefront_snapshot").select("product_id",{count:"exact",head:true}));
await t("newest", ()=>db.from("storefront_snapshot").select("product_id, title",{count:"exact"}).order("updated_at",{ascending:false,nullsFirst:false}).range(0,7));
await t("colls", ()=>db.from("shopify_collections").select("id, handle").order("title").limit(100));
await t("snapcols", ()=>db.from("storefront_snapshot").select("collection_handles, image_url").limit(5000));
