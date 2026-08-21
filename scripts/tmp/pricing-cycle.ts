import { runPriceAuthorityCycle } from "@/lib/pricing/authority.server";
const passes = Number(process.argv[2] ?? 1);
for (let i = 0; i < passes; i += 1) {
  const c = await runPriceAuthorityCycle({ pushLimit: 100 });
  console.log(JSON.stringify({ pass: i + 1, cost: c.cost, reconcile: c.reconcile, push: c.push, parity: { ok: c.parity.ok, rows: c.parity.authorityRows, nonCharm: c.parity.nonCharm, mirror: c.parity.mirrorMismatches, held: c.parity.held } }));
}
