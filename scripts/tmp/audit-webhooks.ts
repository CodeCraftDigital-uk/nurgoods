import { shopifyGraphql, intakeCredentials } from "@/lib/services/shopify.server";
const c = await intakeCredentials();
const d: any = await shopifyGraphql(c, `{ webhookSubscriptions(first:50){nodes{id topic createdAt endpoint{__typename ... on WebhookHttpEndpoint{callbackUrl}}}} }`, {});
for (const n of d.webhookSubscriptions.nodes) console.log(n.topic, "|", n.endpoint?.callbackUrl, "|", n.createdAt);
