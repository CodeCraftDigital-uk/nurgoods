import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;
const db = createClient(url, key, {auth:{persistSession:false}, global:{fetch:(i,init)=>{const h=new Headers(init?.headers);h.delete("Authorization");h.set("apikey",key);return fetch(i,{...init,headers:h});}}});
async function t(n:string,f:()=>any){const s=Date.now();try{const r=await f();console.log(n,Date.now()-s,r.error?.message ?? (r.count ?? r.data?.length));}catch(e:any){console.log(n,Date.now()-s,"THROW",e.message);}}
await t("count", ()=>db.from("storefront_snapshot").select("product_id",{count:"exact",head:true}));
await t("newest", ()=>db.from("storefront_snapshot").select("product_id, title",{count:"exact"}).order("updated_at",{ascending:false,nullsFirst:false}).range(0,7));
await t("colls", ()=>db.from("shopify_collections").select("id, handle").order("title").limit(100));
await t("snapcols", ()=>db.from("storefront_snapshot").select("collection_handles, image_url").limit(5000));
