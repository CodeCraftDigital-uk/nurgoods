import { describe, expect, it } from "vitest";
import {
  decideRepairAction,
  deletionAllowed,
  requiresDraftFirst,
  shouldSweepStale,
  surfacesComplete,
  withinImpactGuard,
  type RepairEvidence,
} from "./repair";

const good: RepairEvidence = {
  pricingVerified: true,
  sellable: true,
  categoryPermitted: true,
  inventoryAvailable: true,
  contentComplete: true,
  blocker: null,
  notes: [],
};

describe("decideRepairAction", () => {
  it("publishes a fully evidenced product", () => {
    expect(decideRepairAction(good).decision).toBe("publish");
  });

  it("deletes a product with no shipping evidence", () => {
    const verdict = decideRepairAction({ ...good, sellable: false });
    expect(verdict.decision).toBe("delete");
    expect(verdict.reasonCode).toBe("missing_supplier_evidence");
  });

  it("deletes a prohibited category ahead of any other reason", () => {
    const verdict = decideRepairAction({
      ...good,
      categoryPermitted: false,
      pricingVerified: false,
    });
    expect(verdict.reasonCode).toBe("prohibited_category");
  });

  it("deletes when an unresolved duplicate remains", () => {
    expect(decideRepairAction({ ...good, blocker: "duplicate group" }).decision).toBe("delete");
  });
});

describe("deletionAllowed", () => {
  it("allows deletion when nothing references the product", () => {
    expect(deletionAllowed([])).toBeNull();
  });

  it("blocks deletion when an order references the product", () => {
    const verdict = deletionAllowed([{ kind: "order line", detail: "#1002" }]);
    expect(verdict?.decision).toBe("blocked");
    expect(verdict?.reason).toContain("#1002");
  });
});

describe("withinImpactGuard", () => {
  const base = { total: 400, maxShare: 0.1, maxProducts: 50, confirmed: false };

  it("allows a small pass", () => {
    expect(withinImpactGuard({ ...base, affected: 5 }).allowed).toBe(true);
  });

  it("refuses a mass hold that was never authorised", () => {
    const verdict = withinImpactGuard({ ...base, affected: 174 });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain("Refused");
  });

  it("allows a mass hold that was explicitly authorised", () => {
    expect(withinImpactGuard({ ...base, affected: 174, confirmed: true }).allowed).toBe(true);
  });

  it("refuses on share even below the absolute ceiling", () => {
    expect(withinImpactGuard({ ...base, total: 100, affected: 40 }).allowed).toBe(false);
  });

  it("allows a pass that changes nothing", () => {
    expect(withinImpactGuard({ ...base, affected: 0 }).allowed).toBe(true);
  });
});

describe("shouldSweepStale", () => {
  it("does not sweep while the freshness job is paused", () => {
    expect(shouldSweepStale({ freshnessJobEnabled: false, dryRun: false }).sweep).toBe(false);
  });

  it("sweeps while the freshness job is running", () => {
    expect(shouldSweepStale({ freshnessJobEnabled: true, dryRun: false }).sweep).toBe(true);
  });

  it("never sweeps on a dry run", () => {
    expect(shouldSweepStale({ freshnessJobEnabled: true, dryRun: true }).sweep).toBe(false);
  });
});

describe("requiresDraftFirst", () => {
  it("holds a supplier created active product", () => {
    expect(requiresDraftFirst({ origin: "supplier", status: "ACTIVE", pricingVerified: false })).toBe(
      true,
    );
  });

  it("leaves a verified supplier product alone", () => {
    expect(requiresDraftFirst({ origin: "supplier", status: "active", pricingVerified: true })).toBe(
      false,
    );
  });

  it("leaves a store originated product alone", () => {
    expect(requiresDraftFirst({ origin: "store", status: "active", pricingVerified: false })).toBe(
      false,
    );
  });
});

describe("surfacesComplete", () => {
  it("requires all three surfaces", () => {
    expect(surfacesComplete(["online_store", "shop"])).toBe(false);
    expect(surfacesComplete(["online_store", "shop", "headless"])).toBe(true);
  });
});
