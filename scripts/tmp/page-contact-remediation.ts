/**
 * Replaces public email renderings on the live store pages with links to the
 * NUR GOODS contact form. The statutory trader disclosure keeps exactly one
 * address, labelled as the statutory email contact, because UK online selling
 * rules require it. Run with --apply to write; the default is a preview.
 */
import { intakeCredentials } from "@/lib/services/shopify.server";

const CONTACT_URL = "https://nurgoods.com/contact";
const DISCLOSURE_HANDLE = "contact-and-legal-information";
const APPLY = process.argv.includes("--apply");

const c = await intakeCredentials();

async function api(path: string, init?: RequestInit) {
  const response = await fetch(`https://${c.shopDomain}/admin/api/${c.apiVersion}/${path}`, {
    ...init,
    headers: {
      "X-Shopify-Access-Token": c.adminToken,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`${path} ${response.status} ${await response.text()}`);
  await new Promise((r) => setTimeout(r, 600));
  return response.json() as Promise<any>;
}

/** Turns every mailto anchor into an accessible contact form link. */
function anchorsToContactLinks(html: string): string {
  return html.replace(
    /<a\b[^>]*href="mailto:[^"]*"[^>]*>[\s\S]*?<\/a>/gi,
    `<a href="${CONTACT_URL}">Contact us</a>`,
  );
}

/** Removes any address left in plain text outside an anchor. */
function stripBareAddresses(html: string): string {
  return html.replace(/support@nurgoods\.com/gi, "our contact form");
}

const { pages } = await api("pages.json?limit=250");

for (const page of pages) {
  const original: string = page.body_html ?? "";
  if (!/support@nurgoods\.com|mailto:/i.test(original)) continue;

  let next: string;
  if (page.handle === DISCLOSURE_HANDLE) {
    // Keep a single statutory address, in context, and route the rest to the form.
    next = anchorsToContactLinks(original);
    next = stripBareAddresses(next);
    next += `\n<h2>Statutory email contact</h2>\n<p>Under United Kingdom online selling rules we must publish an email contact. That statutory address is support@nurgoods.com. For everyday help please use <a href="${CONTACT_URL}">our contact form</a>, which reaches the same team.</p>`;
  } else {
    next = stripBareAddresses(anchorsToContactLinks(original));
  }

  const remaining = (next.match(/support@nurgoods\.com/gi) ?? []).length;
  const mailtos = (next.match(/mailto:/gi) ?? []).length;
  console.log(
    `${page.handle}: addresses ${(original.match(/support@nurgoods\.com/gi) ?? []).length} -> ${remaining}, mailto ${(original.match(/mailto:/gi) ?? []).length} -> ${mailtos}`,
  );

  if (APPLY && next !== original) {
    await api(`pages/${page.id}.json`, {
      method: "PUT",
      body: JSON.stringify({ page: { id: page.id, body_html: next } }),
    });
    console.log(`  updated ${page.handle}`);
  }
}
console.log(APPLY ? "applied" : "preview only");
