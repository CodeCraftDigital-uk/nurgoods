/**
 * Catalogue repair rules.
 *
 * The repair decides one of three things about every product in the store:
 * publish it, delete it, or stop and report it. Those decisions are made here,
 * away from the network, so the policy can be proven rather than argued about.
 *
 * The same file also holds the safety rules that stop a maintenance pass from
 * quietly taking the shop apart: an impact ceiling on bulk holds, the rule that
 * a stale sweep may only run when the job that keeps facts fresh is actually
 * running, and the draft first rule for supplier created products.
 */

/** The evidence a product must satisfy before it may be put on sale. */
export interface RepairEvidence {
  /** Every variant priced by the canonical formula and read back identical. */
  pricingVerified: boolean;
  /** Fresh supplier facts plus quoted delivery to every required market. */
  sellable: boolean;
  /** Category screening passed: nothing prohibited. */
  categoryPermitted: boolean;
  /** At least one saleable variant with stock the supplier stands behind. */
  inventoryAvailable: boolean;
  /** A handle, a title and at least one image. */
  contentComplete: boolean;
  /** No unresolved duplicate, quarantine or intake block. */
  blocker: string | null;
  /** Why the evidence that is missing is missing, for the audit record. */
  notes: string[];
}

export type RepairDecision = "publish" | "delete" | "blocked";

export interface RepairVerdict {
  decision: RepairDecision;
  reasonCode: string;
  reason: string;
}

/** The single objective rule applied to every draft and every unsafe active. */
export function decideRepairAction(evidence: RepairEvidence): RepairVerdict {
  const failures: Array<[string, string]> = [];
  if (!evidence.categoryPermitted)
    failures.push(["prohibited_category", "the category is not permitted for sale"]);
  if (!evidence.sellable)
    failures.push([
      "missing_supplier_evidence",
      "fresh supplier facts and delivery evidence for both required markets could not be obtained",
    ]);
  if (!evidence.pricingVerified)
    failures.push([
      "pricing_unverified",
      "the approved price could not be written and read back for every variant",
    ]);
  if (!evidence.inventoryAvailable)
    failures.push(["no_saleable_inventory", "no variant has stock the supplier stands behind"]);
  if (!evidence.contentComplete)
    failures.push(["incomplete_content", "the listing is missing a handle, a title or an image"]);
  if (evidence.blocker)
    failures.push(["unresolved_blocker", `an unresolved issue remains: ${evidence.blocker}`]);

  if (failures.length === 0) {
    return {
      decision: "publish",
      reasonCode: "verified",
      reason:
        "Priced on the approved formula, read back from the store, delivery evidenced for both markets and nothing outstanding",
    };
  }

  return {
    decision: "delete",
    reasonCode: failures[0]![0],
    reason: `Removed because ${failures.map(([, text]) => text).join("; ")}`,
  };
}

/** A dependency found against a product that makes deletion unsafe. */
export interface DeletionDependency {
  kind: string;
  detail: string;
}

/**
 * Deletion is only ever allowed against a product nothing else depends on.
 * An order line, a fulfilment or an open supplier obligation stops the item
 * and it is reported rather than improvised around.
 */
export function deletionAllowed(dependencies: DeletionDependency[]): RepairVerdict | null {
  if (dependencies.length === 0) return null;
  return {
    decision: "blocked",
    reasonCode: "dependency",
    reason: `Not deleted because it is still referenced: ${dependencies
      .map((dependency) => `${dependency.kind} (${dependency.detail})`)
      .join("; ")}`,
  };
}

export interface ImpactGuard {
  /** How many products the pass wants to take off sale. */
  affected: number;
  /** How many products the catalogue holds in total. */
  total: number;
  /** Ceiling as a share of the catalogue, 0 to 1. */
  maxShare: number;
  /** Absolute ceiling on one pass. */
  maxProducts: number;
  /** A human authorised this exact pass. */
  confirmed: boolean;
}

export interface ImpactVerdict {
  allowed: boolean;
  reason: string;
}

/**
 * The blast radius rule.
 *
 * A maintenance pass that wants to take a large share of the shop off sale is
 * far more likely to be a broken assumption than a real emergency, so it is
 * refused unless a human authorised that exact pass. This is what turns a
 * silent catalogue wipe into a loud, refused, logged event.
 */
export function withinImpactGuard(guard: ImpactGuard): ImpactVerdict {
  if (guard.affected <= 0) return { allowed: true, reason: "Nothing to take off sale" };
  if (guard.confirmed)
    return { allowed: true, reason: "Explicitly authorised for this pass" };
  if (guard.affected > guard.maxProducts) {
    return {
      allowed: false,
      reason: `Refused: ${guard.affected} listings would be taken off sale in one pass, above the ceiling of ${guard.maxProducts}. Authorise the pass explicitly if this is intended.`,
    };
  }
  const share = guard.total > 0 ? guard.affected / guard.total : 1;
  if (share > guard.maxShare) {
    return {
      allowed: false,
      reason: `Refused: ${guard.affected} of ${guard.total} listings (${Math.round(
        share * 100,
      )}%) would be taken off sale, above the ceiling of ${Math.round(
        guard.maxShare * 100,
      )}%. Authorise the pass explicitly if this is intended.`,
    };
  }
  return { allowed: true, reason: "Within the impact ceiling" };
}

/**
 * A stale sweep is only honest while something is actively refreshing the
 * facts. With the freshness job paused, every listing ages past the target by
 * definition, so sweeping would take the whole shop off sale for a reason that
 * is entirely of our own making.
 */
export function shouldSweepStale(input: {
  freshnessJobEnabled: boolean;
  dryRun: boolean;
}): { sweep: boolean; reason: string } {
  if (input.dryRun) return { sweep: false, reason: "Dry run" };
  if (!input.freshnessJobEnabled)
    return {
      sweep: false,
      reason:
        "The supplier freshness job is paused, so ageing facts are expected and no listing is taken off sale for it",
    };
  return { sweep: true, reason: "The supplier freshness job is running" };
}

/**
 * Supplier created products must land as drafts. If the supplier creates one
 * already active, it is exposed to customers before a single gate has run, so
 * it is pulled straight back off sale and sent through intake.
 */
export function requiresDraftFirst(input: {
  origin: string | null | undefined;
  status: string | null | undefined;
  pricingVerified: boolean;
}): boolean {
  const origin = String(input.origin ?? "").toLowerCase();
  const status = String(input.status ?? "").toLowerCase();
  if (origin === "" || origin === "store") return false;
  return status === "active" && !input.pricingVerified;
}

/** The three surfaces every remaining product must be present on. */
export const REQUIRED_SURFACES = ["online_store", "shop", "headless"] as const;
export type RequiredSurface = (typeof REQUIRED_SURFACES)[number];

/** True only when all three required selling surfaces are confirmed live. */
export function surfacesComplete(present: string[]): boolean {
  const seen = new Set(present.map((value) => value.toLowerCase()));
  return REQUIRED_SURFACES.every((surface) => seen.has(surface));
}
