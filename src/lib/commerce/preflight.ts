/**
 * Last mile supplier validation before a paid order is committed to the
 * supplier.
 *
 * A fulfilment quote can be minutes old while the underlying supplier facts
 * are days old. Confirming against that is how an order gets placed for a
 * product we can no longer evidence as deliverable or profitable. This gate
 * runs immediately before confirmation and re-reads the mapped supplier link
 * for every line on the order.
 *
 * Pure decision logic so it can be proven directly. Anything unresolved sends
 * the order to manual review and nothing is submitted or charged.
 */

export interface PreflightLine {
  /** Store variant the customer actually bought. */
  shopifyVariantId: string | null;
  shopifyProductId: string | null;
  quantity: number;
  title: string | null;
}

export interface PreflightLink {
  shopifyProductId: string | null;
  syncState: string | null;
  lastSyncAt: string | null;
  manualHold: boolean;
  landedCost: number | null;
  /** Supplier variant mapping recorded at import time. */
  variantMap: Array<{ store_variant_id?: string | null; sku?: string | null }>;
  /** Supplier variant SKUs currently reported as unsellable, when known. */
  blockedVariantSkus?: string[] | null;
}

export interface PreflightDecision {
  ok: boolean;
  code: string;
  reason: string;
  /** Lines that could not be cleared, for the operator note. */
  offendingLines: string[];
}

/** Sync states that evidence a listing as currently sellable. */
const SELLABLE_STATES = new Set(["healthy", "repriced"]);

function ageHours(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return null;
  return (now - parsed) / 3_600_000;
}

function describe(line: PreflightLine): string {
  return line.title ?? line.shopifyVariantId ?? line.shopifyProductId ?? "an order line";
}

/**
 * Clears an order for supplier submission, or refuses it.
 *
 * Every one of these refusals is deliberate. None of them are recoverable by
 * retrying against the same facts, so each one parks the order for a person.
 */
export function supplierPreflightDecision(input: {
  lines: PreflightLine[];
  links: PreflightLink[];
  now?: number;
  staleHours?: number;
}): PreflightDecision {
  const now = input.now ?? Date.now();
  const staleHours = input.staleHours ?? 72;
  const lines = input.lines;

  if (lines.length === 0) {
    return {
      ok: false,
      code: "preflight_no_lines",
      reason: "The order has no lines to validate against the supplier.",
      offendingLines: [],
    };
  }

  const byProduct = new Map<string, PreflightLink>();
  for (const link of input.links) {
    if (link.shopifyProductId) byProduct.set(String(link.shopifyProductId), link);
  }

  const unmapped: string[] = [];
  const stale: string[] = [];
  const held: string[] = [];
  const unpriced: string[] = [];
  const outOfStock: string[] = [];
  const badQuantity: string[] = [];

  for (const line of lines) {
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      badQuantity.push(describe(line));
      continue;
    }
    const link = line.shopifyProductId ? byProduct.get(String(line.shopifyProductId)) : undefined;
    if (!link) {
      unmapped.push(describe(line));
      continue;
    }
    const mapping = link.variantMap.find(
      (entry) =>
        entry?.store_variant_id &&
        line.shopifyVariantId &&
        String(entry.store_variant_id) === String(line.shopifyVariantId),
    );
    if (!mapping) {
      unmapped.push(describe(line));
      continue;
    }
    if (link.manualHold) {
      held.push(describe(line));
      continue;
    }
    if (!SELLABLE_STATES.has(String(link.syncState ?? ""))) {
      held.push(describe(line));
      continue;
    }
    const age = ageHours(link.lastSyncAt, now);
    if (age === null || age > staleHours) {
      stale.push(describe(line));
      continue;
    }
    if (link.landedCost === null || !Number.isFinite(link.landedCost)) {
      unpriced.push(describe(line));
      continue;
    }
    const blocked = link.blockedVariantSkus ?? [];
    if (mapping.sku && blocked.includes(String(mapping.sku))) {
      outOfStock.push(describe(line));
    }
  }

  if (badQuantity.length > 0) {
    return {
      ok: false,
      code: "preflight_quantity",
      reason: `The quantity on ${badQuantity.length} line(s) is not a positive number, so nothing was submitted to the supplier.`,
      offendingLines: badQuantity,
    };
  }
  if (unmapped.length > 0) {
    return {
      ok: false,
      code: "preflight_unmapped_variant",
      reason: `${unmapped.length} line(s) have no supplier variant mapping, so the exact supplier item cannot be evidenced and nothing was submitted.`,
      offendingLines: unmapped,
    };
  }
  if (outOfStock.length > 0) {
    return {
      ok: false,
      code: "preflight_out_of_stock",
      reason: `${outOfStock.length} line(s) are reported unsellable by the supplier, so nothing was submitted.`,
      offendingLines: outOfStock,
    };
  }
  if (held.length > 0) {
    return {
      ok: false,
      code: "preflight_supplier_hold",
      reason: `${held.length} line(s) are on a supplier hold, so nothing was submitted.`,
      offendingLines: held,
    };
  }
  if (stale.length > 0) {
    return {
      ok: false,
      code: "preflight_stale_supplier_facts",
      reason: `${stale.length} line(s) rely on supplier facts older than ${staleHours} hours, so nothing was submitted until they are re-read.`,
      offendingLines: stale,
    };
  }
  if (unpriced.length > 0) {
    return {
      ok: false,
      code: "preflight_ambiguous_cost",
      reason: `${unpriced.length} line(s) have no evidenced landed cost, so the economics are ambiguous and nothing was submitted.`,
      offendingLines: unpriced,
    };
  }

  return {
    ok: true,
    code: "preflight_clear",
    reason: "Every line maps to a current, in stock, priced supplier variant.",
    offendingLines: [],
  };
}
