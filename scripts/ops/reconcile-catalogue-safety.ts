/**
 * Operational reconciliation for catalogue safety.
 *
 * Rebuilds supplier linkage from supplier reported evidence, then takes any
 * listing that still cannot be proven off every sales channel. It never
 * publishes, never archives and never places a supplier order.
 *
 * Usage: bun scripts/ops/reconcile-catalogue-safety.ts [--apply]
 */
const apply = process.argv.includes("--apply");

const { recoverSupplierLinkage } = await import("@/lib/pricing/linkage.server");
const { enforceSellabilityHold } = await import("@/lib/intake/sellability.server");

const linkage = await recoverSupplierLinkage().catch((cause) => ({
  message: cause instanceof Error ? cause.message : String(cause),
}));
console.log("linkage", JSON.stringify(linkage));

const hold = await enforceSellabilityHold({ apply, limit: 200 });
console.log(
  "hold",
  JSON.stringify({
    attempted: hold.attempted,
    heldOff: hold.heldOff,
    alreadyOff: hold.alreadyOff,
    failed: hold.failed.length,
    sellable: hold.audit.sellable,
    total: hold.audit.total,
    applied: hold.applied,
  }),
);
