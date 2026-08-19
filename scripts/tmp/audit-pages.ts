import { runPublicationAudit } from "@/lib/zendrop/publication-audit.server";

const drifted: string[] = [];
let offset = 0;
let inspected = 0;
for (let pass = 0; pass < 20; pass += 1) {
  const run = await runPublicationAudit({ dryRun: true, limit: 50, offset });
  inspected += run.inspected;
  for (const item of run.items) if (item.drifted) drifted.push(item.shopifyProductId);
  console.log(
    `pass ${pass} offset=${run.offset} inspected=${run.inspected} drifted=${run.drifted} total=${run.totalMatched} next=${run.nextOffset}`,
  );
  if (run.nextOffset === null) break;
  offset = run.nextOffset;
}
console.log("TOTAL inspected", inspected, "drifted", drifted.length, drifted);
