import { createHmac } from "crypto";
import { getWebhookSigningSecret } from "@/lib/services/shopify.server";
const secret = await getWebhookSigningSecret();
if (!secret) throw new Error("no secret");
const payload = {
  id: 9999000000001, admin_graphql_api_id: "gid://shopify/Order/9999000000001",
  name: "#SYNTHETIC-1", order_number: 999001, financial_status: "paid",
  fulfillment_status: null, currency: "GBP", total_price: "1.99",
  shipping_address: { country_code: "GB", city: "London" },
  line_items: [{ id: 1, admin_graphql_api_id: "gid://shopify/LineItem/1", variant_id: 1, product_id: 1, sku: "SYNTH-1", title: "Synthetic", quantity: 1, price: "1.99" }],
};
const body = JSON.stringify(payload);
const sig = createHmac("sha256", secret).update(body, "utf8").digest("base64");
const url = "https://nurgoods.com/api/public/hooks/shopify-orders";
for (const attempt of [1, 2]) {
  const res = await fetch(url, { method: "POST", body, headers: {
    "content-type": "application/json", "x-shopify-hmac-sha256": sig,
    "x-shopify-topic": "orders/paid", "x-shopify-webhook-id": "synthetic-delivery-1" } });
  console.log("attempt", attempt, res.status, await res.text());
}
