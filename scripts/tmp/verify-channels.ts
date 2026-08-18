import { zendropAdminClient } from "../../src/lib/zendrop/client.server";
import { readStorePublications } from "../../src/lib/zendrop/store-publication.server";

const sb = await zendropAdminClient();
const { data } = await sb
  .from("shopify_products")
  .select("shopify_product_id, title, status")
  .order("title", { ascending: true });
const rows = (data ?? []) as Array<{
  shopify_product_id: string;
  title: string | null;
  status: string | null;
}>;

let activeInspected = 0;
let activeCompliant = 0;
let drafts = 0;
const problems: string[] = [];
let turtle: unknown = null;

for (const row of rows) {
  if (row.status !== "active") {
    drafts += 1;
    continue;
  }
  activeInspected += 1;
  try {
    const report = await readStorePublications(String(row.shopify_product_id));
    if (!report.drifted) activeCompliant += 1;
    else problems.push(`${report.title}: ${report.currentChannels.join(", ")}`);
    if ((report.title ?? "").toLowerCase().includes("turtle")) {
      turtle = {
        title: report.title,
        status: report.status,
        channels: report.channels,
        drifted: report.drifted,
      };
    }
  } catch (cause) {
    problems.push(`${row.title}: ${cause instanceof Error ? cause.message : "unreadable"}`);
  }
}

console.log(
  JSON.stringify({ activeInspected, activeCompliant, drafts, problems, turtle }, null, 2),
);
