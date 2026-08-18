import { getWebhookSubscriptionState, registerIntakeWebhooks, orderWebhookCallbackUrl, getOrderWebhookState } from "../../src/lib/services/shopify.server";
const intake = "https://admin.nurgoods.com/api/public/hooks/shopify-intake";
console.log("intake(admin) before:", JSON.stringify(await getWebhookSubscriptionState(intake)));
console.log("intake(public) before:", JSON.stringify(await getWebhookSubscriptionState("https://nurgoods.com/api/public/hooks/shopify-intake")));
try { console.log("orders:", JSON.stringify(await (getOrderWebhookState as any)(orderWebhookCallbackUrl()))); } catch (e) { console.log("orders state fn:", (e as Error).message); }
