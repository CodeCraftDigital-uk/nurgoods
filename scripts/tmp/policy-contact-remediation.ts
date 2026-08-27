/**
 * Replaces public email renderings inside the store legal policies with links
 * to the NUR GOODS contact form. The contact information policy is the single
 * statutory disclosure, so it keeps one address in clear context. Preview by
 * default, --apply to write.
 */
import { intakeCredentials, shopifyGraphql } from "@/lib/services/shopify.server";

const CONTACT_URL = "https://nurgoods.com/contact";
const APPLY = process.argv.includes("--apply");
const c = await intakeCredentials();

function rewrite(html: string): string {
  return html
    .replace(
      /<a\b[^>]*href="mailto:[^"]*"[^>]*>[\s\S]*?<\/a>/gi,
      `<a href="${CONTACT_URL}">Contact us</a>`,
    )
    .replace(/support@nurgoods\.com/gi, "our contact form");
}

const data = await shopifyGraphql<any>(c, `{ shop { shopPolicies { type body } } }`);

for (const policy of data.shop.shopPolicies ?? []) {
  const body: string = policy.body ?? "";
  if (!/support@nurgoods\.com|mailto:/i.test(body)) continue;

  let next = rewrite(body);
  if (policy.type === "CONTACT_INFORMATION") {
    next += `\n<h2>Statutory email contact</h2>\n<p>United Kingdom online selling rules require an email contact to be published. That statutory address is support@nurgoods.com. For everyday help please use <a href="${CONTACT_URL}">our contact form</a>, which reaches the same team.</p>`;
  }

  const before = (body.match(/support@nurgoods\.com/gi) ?? []).length;
  const after = (next.match(/support@nurgoods\.com/gi) ?? []).length;
  console.log(`${policy.type}: addresses ${before} -> ${after}`);

  if (!APPLY) continue;
  const result = await shopifyGraphql<any>(
    c,
    `mutation Update($policy: ShopPolicyInput!) {
       shopPolicyUpdate(shopPolicy: $policy) {
         shopPolicy { type }
         userErrors { field message }
       }
     }`,
    { policy: { type: policy.type, body: next } },
  );
  const errors = result.shopPolicyUpdate?.userErrors ?? [];
  console.log(errors.length ? `  FAILED ${JSON.stringify(errors)}` : `  updated ${policy.type}`);
}
console.log(APPLY ? "applied" : "preview only");
