/**
 * Merchant authorised reconciliation to the headless channel only.
 * Walks every ACTIVE product in bounded batches through the guarded
 * reconciliation path, then verifies each batch straight from the store.
 * Touches channels only: never status, price, variants or inventory.
 */
import { zendropAdminClient } from "../../src/lib/zendrop/client.server";
import { ensureStorePublications, readStorePublications } from "../../src/lib/zendrop/store-publication.server";

const sb = await zendropAdminClient();
const rows: Array<{ shopify_product_id: string; title: string | null; status: string | null }> = [];
for (let offset = 0; ; offset += 500) {
  const { data } = await sb
    .from("shopify_products")
    .select("shopify_product_id, title, status")
    .order("shopify_product_id", { ascending: true })
    .range(offset, offset + 499);
  const batch = (data ?? []) as typeof rows;
  rows.push(...batch);
  if (batch.length < 500) break;
}
const active = rows.filter((r) => r.status === "active");
console.log("active products:", active.length);

let changed = 0;
let compliant = 0;
const failures: Array<{ id: string; title: string | null; message: string }> = [];

for (let i = 0; i < active.length; i += 10) {
  const batch = active.slice(i, i + 10);
  for (const row of batch) {
    const id = String(row.shopify_product_id);
    try {
      const result = await ensureStorePublications(id, undefined, { removeUnwanted: true });
      if (result.published.length > 0 || result.unpublished.length > 0) changed += 1;
    } catch (cause) {
      failures.push({
        id,
        title: row.title,
        message: cause instanceof Error ? cause.message : "reconcile failed",
      });
    }
  }
  for (const row of batch) {
    const id = String(row.shopify_product_id);
    try {
      const report = await readStorePublications(id);
      if (report.drifted) {
        failures.push({
          id,
          title: report.title,
          message: `Still on ${report.currentChannels.join(", ") || "no channel"}`,
        });
      } else {
        compliant += 1;
      }
    } catch (cause) {
      failures.push({
        id,
        title: row.title,
        message: cause instanceof Error ? cause.message : "unreadable",
      });
    }
  }
  console.log(
    `batch ${Math.floor(i / 10) + 1}: changed so far ${changed}, verified compliant ${compliant}, failures ${failures.length}`,
  );
}

console.log(JSON.stringify({ total: active.length, changed, compliant, failures }, null, 2));
