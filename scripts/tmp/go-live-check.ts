import { getOrderWebhookState, getWebhookSubscriptionState, orderWebhookCallbackUrl } from "@/lib/services/shopify.server";
const url = orderWebhookCallbackUrl();
console.log("callbackUrl:", url);
const probe = await fetch(url, { method: "POST", body: "{}" }).then(r => r.status).catch(e => "ERR " + e.message);
console.log("probe status (401 = live & signature-guarded):", probe);
console.log("order webhooks:", JSON.stringify(await getOrderWebhookState(), null, 2));
console.log("intake webhooks:", JSON.stringify(await getWebhookSubscriptionState(), null, 2));
