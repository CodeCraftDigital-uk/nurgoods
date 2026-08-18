import { getOrderWebhookState } from "../../src/lib/services/shopify.server";
const s = await getOrderWebhookState();
console.log(JSON.stringify(s.registered));
