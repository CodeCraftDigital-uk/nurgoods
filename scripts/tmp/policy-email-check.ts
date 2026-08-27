/** Read only: checks the store legal policies for public email renderings. */
import { intakeCredentials, shopifyGraphql } from "@/lib/services/shopify.server";
const c = await intakeCredentials();
const data = await shopifyGraphql<any>(c, `{ shop { shopPolicies { type body } } }`);
for (const p of data.shop.shopPolicies ?? []) {
  const hits = (p.body?.match(/support@nurgoods\.com|mailto:/gi) ?? []).length;
  console.log(p.type, "hits:", hits);
}
