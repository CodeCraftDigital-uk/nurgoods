/**
 * Applies the sellability hold: takes unproven listings off every sales
 * channel. Pass "apply" as the first argument to make store writes; without it
 * the run is a dry run.
 */
import { enforceSellabilityHold } from "../../src/lib/intake/sellability.server";

const apply = process.argv[2] === "apply";
const result = await enforceSellabilityHold({ apply, limit: 200 });
console.log(
  JSON.stringify(
    {
      applied: result.applied,
      attempted: result.attempted,
      heldOff: result.heldOff,
      alreadyOff: result.alreadyOff,
      failed: result.failed.slice(0, 5),
      failedCount: result.failed.length,
      message: result.message,
      audit: {
        active: result.audit.activeProducts,
        sellable: result.audit.sellable,
        held: result.audit.held,
        reasons: result.audit.reasonCounts,
      },
    },
    null,
    2,
  ),
);
