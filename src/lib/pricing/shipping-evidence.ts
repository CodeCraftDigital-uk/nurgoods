/**
 * Supplier shipping evidence policy.
 *
 * Order #1001 exposed the failure this module exists to prevent: a listing
 * carried a stored shipping figure of GBP 2.49 while the supplier actually
 * charged USD 4.32 for the same delivery. The stored figure came from a
 * generic catalogue shipping value that was converted at the raw reference
 * rate, with no record of which destination or which service it belonged to
 * and no record of when it was taken. It looked like evidence but it was not
 * comparable to the quote that the supplier applies at order time.
 *
 * From here on a shipping figure may only be used for pricing when it is a
 * destination specific quote for the configured shipping market, in a known
 * currency, for a named service, taken recently enough to still be true.
 * Anything else fails closed.
 */

export const SHIPPING_EVIDENCE_STATUSES = [
  "verified",
  "missing",
  "stale",
  "wrong_destination",
  "ambiguous",
] as const;

export type ShippingEvidenceStatus = (typeof SHIPPING_EVIDENCE_STATUSES)[number];

export const SHIPPING_EVIDENCE_LABEL: Record<ShippingEvidenceStatus, string> = {
  verified: "Verified quote",
  missing: "No shipping evidence",
  stale: "Quote too old",
  wrong_destination: "Quote is for another destination",
  ambiguous: "Quote basis is unclear",
};

export interface ShippingEvidence {
  amount: number | null | undefined;
  currency: string | null | undefined;
  destination: string | null | undefined;
  service: string | null | undefined;
  quotedAt: string | Date | null | undefined;
}

export interface ShippingEvidencePolicy {
  /** Market the store ships to, for example GB. */
  market: string;
  maxAgeDays: number;
  now?: Date;
}

export interface ShippingEvidenceAssessment {
  status: ShippingEvidenceStatus;
  usable: boolean;
  amount: number | null;
  currency: string | null;
  ageDays: number | null;
  reason: string | null;
}

function fail(
  status: Exclude<ShippingEvidenceStatus, "verified">,
  reason: string,
  ageDays: number | null = null,
): ShippingEvidenceAssessment {
  return { status, usable: false, amount: null, currency: null, ageDays, reason };
}

export function assessShippingEvidence(
  evidence: ShippingEvidence,
  policy: ShippingEvidencePolicy,
): ShippingEvidenceAssessment {
  const amount = typeof evidence.amount === "number" ? evidence.amount : null;
  if (amount === null || !Number.isFinite(amount) || amount < 0) {
    return fail("missing", "No supplier shipping quote is recorded for this listing");
  }

  const currency = (evidence.currency ?? "").trim().toUpperCase();
  if (!currency) {
    return fail(
      "ambiguous",
      "The stored shipping figure has no currency, so it cannot be converted or compared",
    );
  }

  const destination = (evidence.destination ?? "").trim().toUpperCase();
  if (!destination) {
    return fail(
      "ambiguous",
      "The stored shipping figure does not say which destination it was quoted for",
    );
  }
  if (destination !== policy.market.trim().toUpperCase()) {
    return fail(
      "wrong_destination",
      `The shipping quote is for ${destination} but the store ships to ${policy.market}`,
    );
  }

  if (!(evidence.service ?? "").trim()) {
    return fail(
      "ambiguous",
      "The stored shipping figure does not name the shipping service it was quoted for",
    );
  }

  const quotedAt = evidence.quotedAt ? new Date(evidence.quotedAt) : null;
  if (!quotedAt || Number.isNaN(quotedAt.getTime())) {
    return fail("ambiguous", "The stored shipping figure has no quote timestamp");
  }

  const now = policy.now ?? new Date();
  const ageDays = Math.floor((now.getTime() - quotedAt.getTime()) / 86_400_000);
  if (ageDays < 0) {
    return fail("ambiguous", "The shipping quote is timestamped in the future", ageDays);
  }
  if (ageDays > policy.maxAgeDays) {
    return fail(
      "stale",
      `The shipping quote is ${ageDays} days old and the policy allows ${policy.maxAgeDays} days`,
      ageDays,
    );
  }

  return { status: "verified", usable: true, amount, currency, ageDays, reason: null };
}
