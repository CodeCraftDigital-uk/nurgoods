import { describe, expect, it } from "vitest";
import { evaluateSellability } from "./sellability";

const now = new Date("2026-08-19T10:00:00Z");
const fresh = "2026-08-19T08:00:00Z";

const markets = [
  { market: "GB", eligible: true, quotedAt: fresh },
  { market: "US", eligible: true, quotedAt: fresh },
];

describe("sellability gate", () => {
  it("passes only when mapping and both market quotes are proven", () => {
    const verdict = evaluateSellability({
      link: { variantMap: [{ store_variant_id: "1" }], lastSupplierSyncAt: fresh },
      markets,
      now,
    });
    expect(verdict.sellable).toBe(true);
    expect(verdict.reasons).toEqual([]);
  });

  it("refuses a product with no supplier link", () => {
    const verdict = evaluateSellability({ link: null, markets, now });
    expect(verdict.sellable).toBe(false);
    expect(verdict.reasons).toContain("no_supplier_link");
  });

  it("refuses an empty variant map, a manual hold and an unavailable supplier", () => {
    expect(
      evaluateSellability({ link: { variantMap: [], lastSupplierSyncAt: fresh }, markets, now }).reasons,
    ).toContain("no_variant_map");
    expect(
      evaluateSellability({
        link: { variantMap: [{}], manualHold: true, lastSupplierSyncAt: fresh },
        markets,
        now,
      }).reasons,
    ).toContain("manual_hold");
    expect(
      evaluateSellability({
        link: { variantMap: [{}], supplierAvailable: false, lastSupplierSyncAt: fresh },
        markets,
        now,
      }).reasons,
    ).toContain("supplier_unavailable");
  });

  it("refuses stale or unverified supplier evidence", () => {
    expect(
      evaluateSellability({
        link: { variantMap: [{}], lastSupplierSyncAt: "2026-08-10T08:00:00Z" },
        markets,
        now,
      }).reasons,
    ).toContain("supplier_evidence_stale");
    expect(
      evaluateSellability({ link: { variantMap: [{}] }, markets, now }).reasons,
    ).toContain("no_supplier_verification");
  });

  it("accepts UK only or USA only shipping evidence", () => {
    const ukOnly = evaluateSellability({
      link: { variantMap: [{}], lastSupplierSyncAt: fresh },
      markets: [{ market: "GB", eligible: true }],
      now,
    });
    expect(ukOnly.sellable).toBe(true);

    const usOnly = evaluateSellability({
      link: { variantMap: [{}], lastSupplierSyncAt: fresh },
      markets: [{ market: "gb", eligible: false }, { market: "US", eligible: true }],
      now,
    });
    expect(usOnly.sellable).toBe(true);
  });

  it("refuses a product shippable to neither market", () => {
    const verdict = evaluateSellability({
      link: { variantMap: [{}], lastSupplierSyncAt: fresh },
      markets: [{ market: "GB", eligible: false }],
      now,
    });
    expect(verdict.sellable).toBe(false);
    expect(verdict.reasons).toContain("no_shippable_market");
    expect(verdict.reasons).toContain("not_shippable_gb");
    expect(verdict.reasons).toContain("no_shipping_evidence_us");
  });
});
