/**
 * Re-publishes listings that are sellable under the current gate but were
 * taken off every sales channel by an earlier, stricter pass.
 * Only publishes approved channels. Never activates, prices or archives.
 */
import { auditSellability } from "../../src/lib/intake/sellability.server";
import { ensureStorePublications } from "../../src/lib/zendrop/store-publication.server";

const apply = process.argv.includes("--apply");
const limit = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 400);

const audit = await auditSellability();
const proven = audit.rows.filter((row) => row.verdict.sellable).slice(0, limit);
console.log(`active ${audit.activeProducts}, sellable ${audit.sellable}, checking ${proven.length}`);

let restored = 0;
let alreadyLive = 0;
const failures: Array<{ id: string; message: string }> = [];

for (const row of proven) {
  try {
    const result = await ensureStorePublications(row.shopifyProductId, undefined, {
      removeUnwanted: false,
      dryRun: !apply,
    });
    if (result.published.length > 0) {
      restored += 1;
      console.log(`${apply ? "published" : "would publish"} ${row.shopifyProductId}: ${result.published.join(", ")}`);
    } else alreadyLive += 1;
  } catch (cause) {
    failures.push({
      id: row.shopifyProductId,
      message: cause instanceof Error ? cause.message : "publish failed",
    });
  }
}

console.log(
  JSON.stringify({ apply, restored, alreadyLive, failures: failures.length, firstFailure: failures[0] ?? null }, null, 2),
);
