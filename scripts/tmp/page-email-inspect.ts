/** Read only: shows the email bearing fragments of the live store pages. */
import { intakeCredentials } from "@/lib/services/shopify.server";
const c = await intakeCredentials();
const res = await fetch(`https://${c.shopDomain}/admin/api/${c.apiVersion}/pages.json?limit=250`, {
  headers: { "X-Shopify-Access-Token": c.adminToken },
});
const { pages } = (await res.json()) as any;
for (const page of pages) {
  const html: string = page.body_html ?? "";
  if (!/support@nurgoods\.com|mailto:/i.test(html)) continue;
  console.log(`\n=== ${page.handle} (${page.id}) ===`);
  for (const match of html.split(/(?=<)/).filter((s) => /support@nurgoods|mailto:/i.test(s))) {
    console.log("  ", match.trim().slice(0, 300));
  }
}
