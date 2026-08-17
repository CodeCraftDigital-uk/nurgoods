import { enforceLivePricingIntegrity } from "../../src/lib/pricing/integrity.server";
const r = await enforceLivePricingIntegrity({ dryRun: true });
console.log(r.message);
console.log({ correct: r.correct, pipelineFailed: r.pipelineFailed, unverified: r.unverifiedButLive, exempt: r.exempt, productsHeld: r.productsHeld, productsRepriced: r.productsRepriced, variantsRepriced: r.variantsRepriced });
const charmNoBasis = r.verdicts.filter(v=>v.category==="correct" && v.expectedPrice===null);
console.log("charm-but-unverified variants:", charmNoBasis.length, "products:", new Set(charmNoBasis.map(v=>v.productTitle)).size);
for (const a of r.actions.filter(a=>a.action!=="none")) console.log(a.action, "|", a.title.slice(0,45), "|", a.variantsRepriced, "|", (a.reason??"").slice(0,90));
const fan = r.verdicts.filter(v=>v.productTitle.includes("Hologram"));
console.log(JSON.stringify(fan, null, 1));
