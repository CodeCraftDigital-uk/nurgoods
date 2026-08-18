import { registerIntakeWebhooks } from "../../src/lib/services/shopify.server";
console.log(JSON.stringify(await registerIntakeWebhooks("https://admin.nurgoods.com/api/public/hooks/shopify-intake"), null, 2));
