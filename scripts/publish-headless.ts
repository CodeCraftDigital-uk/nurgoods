import { ensureStorePublications } from "../src/lib/zendrop/store-publication.server";
import { supabaseAdmin } from "../src/integrations/supabase/client.server";
const { data } = await supabaseAdmin.from("shopify_products").select("shopify_product_id,title,status").eq("status","active");
let ok=0, already=0, failed:string[]=[];
for (const p of (data ?? []) as any[]) {
  try {
    const r = await ensureStorePublications(p.shopify_product_id);
    if (r.published.length) ok++; else already++;
    if (!r.published.length && /error|not/i.test(r.message) && !/Already/i.test(r.message)) failed.push(`${p.title}: ${r.message}`);
  } catch (e:any) { failed.push(`${p.title}: ${e?.message}`); }
}
console.log({ total: data?.length ?? 0, published: ok, already, failedCount: failed.length });
console.log(failed.slice(0,10));
