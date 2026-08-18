import { resolveShopifyCredentials } from "@/lib/services/shopify.server";
const r = await resolveShopifyCredentials();
console.log(JSON.stringify({ shopDomain: r.shopDomain, clientId: r.clientId, hasSecret: Boolean(r.clientSecret) }));
