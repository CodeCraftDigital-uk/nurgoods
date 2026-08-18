import { getOrderWebhookState, registerOrderWebhooks, orderWebhookCallbackUrl } from "../../src/lib/services/shopify.server";
const url = orderWebhookCallbackUrl();
console.log("callback:", url);
console.log("before:", JSON.stringify(await getOrderWebhookState(url)));
if (process.argv.includes("--register")) {
  console.log("after:", JSON.stringify(await registerOrderWebhooks(url)));
}
