/**
 * Read only, full catalogue channel report.
 * Walks every product recorded in the catalogue (no 50 row ceiling) and reads
 * the real publication state from the store. Writes nothing anywhere.
 */
import { zendropAdminClient } from "../../src/lib/zendrop/client.server";
import { readStorePublications } from "../../src/lib/zendrop/store-publication.server";

const sb = await zendropAdminClient();
const rows: Array<{ shopify_product_id: string; title: string | null; status: string | null }> = [];
const page = 500;
for (let offset = 0; ; offset += page) {
  const { data } = await sb
    .from("shopify_products")
    .select("shopify_product_id, title, status")
    .order("shopify_product_id", { ascending: true })
    .range(offset, offset + page - 1);
  const batch = (data ?? []) as typeof rows;
  rows.push(...batch);
  if (batch.length < page) break;
}

const active = rows.filter((r) => r.status === "active");
const counts: Record<string, number> = {};
const offenders: Array<{ id: string; title: string | null; channels: string[] }> = [];
const missingHeadless: Array<{ id: string; title: string | null; channels: string[] }> = [];
const errors: Array<{ id: string; message: string }> = [];
let inspected = 0;

for (const row of active) {
  const id = String(row.shopify_product_id);
  try {
    const report = await readStorePublications(id);
    inspected += 1;
    for (const name of report.currentChannels) counts[name] = (counts[name] ?? 0) + 1;
    const lower = report.currentChannels.map((n) => n.trim().toLowerCase());
    if (!lower.some((n) => n.includes("headless"))) {
      missingHeadless.push({ id, title: report.title, channels: report.currentChannels });
    }
    const bad = report.currentChannels.filter((n) => {
      const v = n.trim().toLowerCase();
      return v === "online store" || v.includes("point of sale");
    });
    if (bad.length > 0) offenders.push({ id, title: report.title, channels: report.currentChannels });
  } catch (cause) {
    errors.push({ id, message: cause instanceof Error ? cause.message : "unreadable" });
  }
}

console.log(
  JSON.stringify(
    {
      catalogueRows: rows.length,
      active: active.length,
      inspected,
      channelMembership: counts,
      onlineStoreOrPosOffenders: offenders,
      missingHeadless,
      errors,
    },
    null,
    2,
  ),
);
