import { supabaseAdmin as db } from "@/integrations/supabase/client.server";
import { verifyPriceParity } from "@/lib/pricing/authority.server";
const { syncShopifyCatalogue } = await import("@/lib/services/shopify.server").catch(()=>({syncShopifyCatalogue:null as any}));
if (syncShopifyCatalogue) { try { console.log("mirror", JSON.stringify(await syncShopifyCatalogue({}))); } catch (e) { console.log("mirror_err", String(e)); } }
console.log("snapshot", JSON.stringify((await db.rpc("refresh_storefront_snapshot" as never)).data));
console.log("parity", JSON.stringify(await verifyPriceParity(), null, 1));
