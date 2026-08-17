import { enforceLivePricingIntegrity } from "../../src/lib/pricing/integrity.server";
const r = await enforceLivePricingIntegrity({ dryRun: false });
console.log(r.message);
console.log({ readBackMismatches: r.readBackMismatches, failures: r.failures, held: r.productsHeld, repriced: r.variantsRepriced, nonCharmAfter: r.nonCharmAfter });
for (const a of r.actions.filter(a=>a.action!=="none")) console.log(a.action, "|", a.title.slice(0,45), "| repriced", a.variantsRepriced, "| readback", a.readBackVerified, "| err", a.error ?? "-");
