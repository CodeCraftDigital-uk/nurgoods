/**
 * Resumable catalogue pricing backfill.
 *
 * Walks the whole catalogue in bounded pages, recalculating every variant on
 * the canonical landed cost formula. It never changes product status and never
 * publishes to a selling channel, so a draft stays a draft with a correct
 * price on it.
 *
 * Usage:
 *   bun scripts/ops/pricing-backfill.ts                 preview, 5 pages
 *   bun scripts/ops/pricing-backfill.ts --apply         write corrections
 *   bun scripts/ops/pricing-backfill.ts --reset         restart the walk
 *   bun scripts/ops/pricing-backfill.ts --passes 20 --products 30
 */
const argv = process.argv.slice(2);
function flag(name: string): boolean {
  return argv.includes(`--${name}`);
}
function value(name: string, fallback: number): number {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const parsed = Number(argv[index + 1]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const backfill = await import("@/lib/pricing/backfill.server");

if (flag("reset")) {
  await backfill.resetPricingBackfill();
  console.log("checkpoint reset");
}

const mode = flag("apply") ? "apply" : "preview";
console.log("mode", mode, JSON.stringify(await backfill.pricingBackfillProgress()));

const run = await backfill.runPricingBackfill({
  mode,
  products: value("products", 20),
  maxPasses: value("passes", 5),
});

for (const pass of run.passes) console.log(pass.message);
console.log("finished", run.finished);
console.log("progress", JSON.stringify(await backfill.pricingBackfillProgress()));
console.log("parity", JSON.stringify(run.parity));
