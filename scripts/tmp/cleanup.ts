import { supabaseAdmin } from "@/integrations/supabase/client.server";
const id = "gid://shopify/Order/9999000000001";
const { data: o } = await supabaseAdmin.from("commerce_orders").select("id").eq("shopify_order_id", id);
for (const row of o ?? []) {
  await supabaseAdmin.from("commerce_order_lines").delete().eq("order_id", (row as any).id);
  await supabaseAdmin.from("commerce_orders").delete().eq("id", (row as any).id);
}
await supabaseAdmin.from("commerce_webhook_deliveries").delete().eq("shopify_order_id", id);
for (const t of ["commerce_orders","commerce_order_lines","commerce_webhook_deliveries"]) {
  const { count } = await supabaseAdmin.from(t as any).select("*", { count: "exact", head: true });
  console.log(t, count);
}
