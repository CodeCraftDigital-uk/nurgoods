import { getOrderWebhookState, registerOrderWebhooks, ORDER_WEBHOOK_CALLBACK_URL } from "@/lib/services/shopify.server";
console.log("before:", JSON.stringify(await getOrderWebhookState()));
console.log("register:", JSON.stringify(await registerOrderWebhooks()));
console.log("idempotent re-run:", JSON.stringify(await registerOrderWebhooks()));
console.log("url:", ORDER_WEBHOOK_CALLBACK_URL);
