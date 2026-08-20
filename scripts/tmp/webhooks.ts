import { getWebhookSubscriptionState, registerIntakeWebhooks, getOrderWebhookState, registerOrderWebhooks } from "@/lib/services/shopify.server";
const intakeUrl = "https://admin.nurgoods.com/api/public/hooks/shopify-intake";
console.log("intake before", JSON.stringify(await getWebhookSubscriptionState(intakeUrl)));
console.log("intake after", JSON.stringify(await registerIntakeWebhooks(intakeUrl)));
console.log("orders before", JSON.stringify(await getOrderWebhookState()));
console.log("orders after", JSON.stringify(await registerOrderWebhooks()));
