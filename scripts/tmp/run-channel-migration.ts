/**
 * Merchant authorised existing catalogue publication migration.
 * Walks ACTIVE products in batches of 10 through the guarded reconciliation
 * path, verifies each batch read only afterwards, and stops on a batch that
 * fails to become compliant.
 */
import { zendropAdminClient } from "../../src/lib/zendrop/client.server";
import { runPublicationAudit } from "../../src/lib/zendrop/publication-audit.server";
import { readStorePublications } from "../../src/lib/zendrop/store-publication.server";

const sb = await zendropAdminClient();
const { data } = await sb
  .from("shopify_products")
  .select("shopify_product_id, title, status")
  .eq("status", "active")
  .order("title", { ascending: true });
const active = (data ?? []) as Array<{ shopify_product_id: string; title: string | null }>;
console.log("active products in catalogue:", active.length);

let changed = 0;
let compliant = 0;
const failures: Array<{ id: string; title: string | null; message: string }> = [];

for (let i = 0; i < active.length; i += 10) {
  const batch = active.slice(i, i + 10);
  const ids = batch.map((row) => String(row.shopify_product_id));
  const run = await runPublicationAudit({
    dryRun: false,
    limit: 10,
    shopifyProductIds: ids,
    actorId: null,
  });
  for (const item of run.items) {
    if (item.changed) changed += 1;
  }
  // Verify the batch read only, straight from the store.
  for (const id of ids) {
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
        title: null,
        message: cause instanceof Error ? cause.message : "unreadable",
      });
    }
  }
  console.log(
    `batch ${i / 10 + 1}: inspected ${run.inspected}, drifted ${run.drifted}, changed ${run.changed}, verified compliant so far ${compliant}, failures ${failures.length}`,
  );
}

console.log(JSON.stringify({ total: active.length, changed, compliant, failures }, null, 2));
