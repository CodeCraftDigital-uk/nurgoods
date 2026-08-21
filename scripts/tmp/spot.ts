import { repriceProducts } from "@/lib/pricing/authority.server";
import { supabaseAdmin as db } from "@/integrations/supabase/client.server";
const { data } = await db.from("shopify_products").select("shopify_product_id,title").ilike("title","%Sunburn%");
console.log(JSON.stringify(data));
const ids = ((data ?? []) as any[]).map(r=>String(r.shopify_product_id));
if (ids.length) console.log(JSON.stringify(await repriceProducts({ shopifyProductIds: ids, dryRun: true }), null, 1));
