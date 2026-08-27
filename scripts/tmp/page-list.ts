import { intakeCredentials } from "@/lib/services/shopify.server";
const c = await intakeCredentials();
const r = await fetch(`https://${c.shopDomain}/admin/api/${c.apiVersion}/pages.json?limit=250`, { headers: { "X-Shopify-Access-Token": c.adminToken } });
const { pages } = (await r.json()) as any;
for (const p of pages) console.log(p.handle, "|", p.title, "| template:", p.template_suffix ?? "default", "| published:", Boolean(p.published_at));
