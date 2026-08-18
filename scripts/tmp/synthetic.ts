import { createHmac } from "crypto";
import { getWebhookSigningSecret, orderWebhookCallbackUrl } from "../../src/lib/services/shopify.server";
const secret = await getWebhookSigningSecret();
if (!secret) throw new Error("no secret");
const url = orderWebhookCallbackUrl();
const body = JSON.stringify({
  id: 9900000000001,
  admin_graphql_api_id: "gid://shopify/Order/9900000000001",
  name: "#SYNTH-TEST-1", order_number: 999001,
  financial_status: "paid", fulfillment_status: null, cancelled_at: null,
  currency: "GBP", total_price: "1.00",
  shipping_address: { country_code: "GB", city: "London" },
  line_items: [{ id: 1, admin_graphql_api_id: "gid://shopify/LineItem/1", sku: "SYNTH-SKU-DOES-NOT-EXIST", title: "Synthetic test line", quantity: 1, price: "1.00" }],
});
const sig = createHmac("sha256", secret).update(body, "utf8").digest("base64");
const wid = "synthetic-test-" + (process.env["WID"] ?? "1");
for (const attempt of [1, 2]) {
  const res = await fetch(url, { method: "POST", headers: {
    "content-type": "application/json",
    "x-shopify-hmac-sha256": sig,
    "x-shopify-topic": "orders/paid",
    "x-shopify-webhook-id": wid,
  }, body });
  console.log("attempt", attempt, res.status, await res.text());
}
