/**
 * Operational entry point for the authorised catalogue repair.
 *
 *   bun scripts/ops/catalogue-repair.ts measure
 *   bun scripts/ops/catalogue-repair.ts start [--live]
 *   bun scripts/ops/catalogue-repair.ts batch <runId> [limit]
 *   bun scripts/ops/catalogue-repair.ts drain <runId> [limit]
 *   bun scripts/ops/catalogue-repair.ts finish <runId>
 *
 * Every mode is bounded and resumable. Nothing is deleted without a tombstone
 * and nothing is put on sale without a price read back from the store.
 */
const command = process.argv[2] ?? "measure";
const arg = process.argv[3] ?? "";
const limit = Number(process.argv[4] ?? "10") || 10;

const repair = await import("@/lib/catalogue/repair.server");

if (command === "measure") {
  console.log(JSON.stringify(await repair.measureCatalogue(), null, 2));
} else if (command === "start") {
  const dryRun = !process.argv.includes("--live");
  console.log(JSON.stringify(await repair.startRepairRun({ dryRun }), null, 2));
} else if (command === "batch") {
  console.log(JSON.stringify(await repair.runRepairBatch({ runId: arg, limit }), null, 2));
} else if (command === "drain") {
  for (let pass = 0; pass < 200; pass += 1) {
    const report = await repair.runRepairBatch({ runId: arg, limit, budgetMs: 240_000 });
    console.log(
      `pass ${pass + 1}: ${report.processed} settled, ${report.published} published, ${report.deleted} removed, ${report.blocked} stopped, ${report.remaining} left`,
    );
    if (report.finished || report.processed === 0) break;
  }
  console.log(JSON.stringify(await repair.finishRepairRun(arg), null, 2));
} else if (command === "finish") {
  console.log(JSON.stringify(await repair.finishRepairRun(arg), null, 2));
} else {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}
