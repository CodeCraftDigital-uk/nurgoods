import { getWebhookSubscriptionState } from "@/lib/services/shopify.server";
const s = await getWebhookSubscriptionState("https://nurgoods.com/api/public/hooks/shopify-intake");
console.log(JSON.stringify(s, null, 1));
