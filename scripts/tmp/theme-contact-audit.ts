/**
 * Read only audit of the published Shopify Online Store theme for public email
 * renderings. Reports the theme in use and any asset containing an address or
 * mailto link so the storefront can be corrected safely.
 */
import { intakeCredentials } from "@/lib/services/shopify.server";

async function rest(path: string, creds: { shopDomain: string; adminToken: string; apiVersion: string }) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const response = await fetch(`https://${creds.shopDomain}/admin/api/${creds.apiVersion}/${path}`, {
      headers: { "X-Shopify-Access-Token": creds.adminToken, "content-type": "application/json" },
    });
    if (response.status === 429 || response.status >= 500) {
      await new Promise((r) => setTimeout(r, 1200 * attempt));
      continue;
    }
    if (!response.ok) throw new Error(`${path} ${response.status} ${await response.text()}`);
    await new Promise((r) => setTimeout(r, 550));
    return response.json() as Promise<any>;
  }
  throw new Error(`${path} exhausted retries`);
}

const c = await intakeCredentials();

const { themes } = await rest("themes.json", c);
for (const theme of themes) console.log(`theme ${theme.id} role=${theme.role} name=${theme.name}`);
const live = themes.find((t: any) => t.role === "main");
console.log("LIVE THEME:", live?.id, live?.name);

const { assets } = await rest(`themes/${live.id}/assets.json`, c);
const candidates = assets.filter((a: any) => /\.(liquid|json)$/.test(a.key));
console.log("assets to scan:", candidates.length);
const hits: string[] = [];
for (const asset of candidates) {
  const data = await rest(`themes/${live.id}/assets.json?asset[key]=${encodeURIComponent(asset.key)}`, c);
  const value: string = data.asset?.value ?? "";
  if (/support@nurgoods\.com|mailto:/i.test(value)) {
    const lines = value.split("\n").filter((l) => /support@nurgoods\.com|mailto:/i.test(l));
    hits.push(`${asset.key}\n    ${lines.slice(0, 4).map((l) => l.trim().slice(0, 160)).join("\n    ")}`);
  }
}
console.log("HITS:", hits.length);
for (const hit of hits) console.log("  " + hit);

// Pages and policies are separate resources.
const { pages } = await rest("pages.json?limit=250", c);
for (const page of pages) {
  if (/support@nurgoods\.com|mailto:/i.test(`${page.body_html ?? ""}`)) console.log("PAGE HIT:", page.handle, page.title);
  else console.log("page ok:", page.handle);
}
