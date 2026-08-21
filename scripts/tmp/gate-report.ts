import { zendropAdminClient } from "../../src/lib/zendrop/client.server";
import { syncApprovedFormulaVersion, pricingGateStats } from "../../src/lib/pricing/gate.server";

const version = await syncApprovedFormulaVersion();
const supabase = await zendropAdminClient();
const { data: rebuilt, error } = await supabase.rpc("refresh_storefront_snapshot" as never);
const gate = await pricingGateStats();
const { data: tshirt } = await supabase
  .from("shopify_product_variants")
  .select("shopify_variant_id, price, product_id, shopify_products!inner(title,status)")
  .ilike("shopify_products.title", "%Tropical Sunburn%")
  .limit(5);
console.log(JSON.stringify({ version, rebuilt, error: error?.message ?? null, gate, tshirt }, null, 2));
