import { describe, expect, it } from "vitest";
import {
  assertOnlyApprovedChannels,
  classifyChannel,
  DEFAULT_PUBLICATION_POLICY,
  evaluateCompliance,
  planPublicationReconciliation,
  resolveHeadlessChannel,
  selectPublicationTargets,
} from "./publication-policy";

const CHANNELS = [
  { id: "gid://shopify/Publication/1", name: "Online Store" },
  { id: "gid://shopify/Publication/2", name: "Point of Sale" },
  { id: "gid://shopify/Publication/3", name: "Shop" },
  { id: "gid://shopify/Publication/4", name: "Nur Goods Headless Store" },
];

describe("sales channel policy", () => {
  it("classifies the four real store channels", () => {
    expect(classifyChannel("Online Store")).toBe("online_store");
    expect(classifyChannel("Point of Sale")).toBe("point_of_sale");
    expect(classifyChannel("Shop")).toBe("shop");
    expect(classifyChannel("Nur Goods Headless Store")).toBe("headless");
  });

  it("publishes to all three live selling surfaces by default", () => {
    const { targets, excluded } = selectPublicationTargets(CHANNELS);
    expect(targets.map((c) => c.name).sort()).toEqual([
      "Nur Goods Headless Store",
      "Online Store",
      "Shop",
    ]);
    const skipped = excluded.map((e) => e.channel.name);
    expect(skipped).toEqual(["Point of Sale"]);
  });

  it("never selects Point of Sale even when an opt in is recorded", () => {
    const { targets } = selectPublicationTargets(CHANNELS, {
      ...DEFAULT_PUBLICATION_POLICY,
      allowPointOfSale: true,
    });
    expect(targets.map((c) => c.name)).not.toContain("Point of Sale");
  });

  it("drops Shop only through a deliberate opt out", () => {
    const { targets } = selectPublicationTargets(CHANNELS, {
      ...DEFAULT_PUBLICATION_POLICY,
      includeShopChannel: false,
    });
    expect(targets.map((c) => c.name).sort()).toEqual([
      "Nur Goods Headless Store",
      "Online Store",
    ]);
  });

  it("drops the Online Store only through a deliberate opt out", () => {
    const { targets } = selectPublicationTargets(CHANNELS, {
      ...DEFAULT_PUBLICATION_POLICY,
      includeOnlineStore: false,
    });
    expect(targets.map((c) => c.name).sort()).toEqual(["Nur Goods Headless Store", "Shop"]);
  });

  it("excludes channels it does not recognise rather than guessing", () => {
    const { targets } = selectPublicationTargets([
      ...CHANNELS,
      { id: "gid://shopify/Publication/9", name: "Some Marketplace" },
    ]);
    expect(targets.map((c) => c.name)).not.toContain("Some Marketplace");
  });

  it("fails closed when the headless channel is missing or ambiguous", () => {
    expect(() => resolveHeadlessChannel([{ id: "1", name: "Online Store" }])).toThrow(
      /could not be found/,
    );
    expect(() =>
      resolveHeadlessChannel([
        { id: "4", name: "Nur Goods Headless Store" },
        { id: "5", name: "Other Headless" },
      ]),
    ).toThrow(/More than one/);
    expect(() => selectPublicationTargets([{ id: "1", name: "Online Store" }])).toThrow();
  });

  it("plans the exact publish and unpublish work for a drifted product", () => {
    const plan = planPublicationReconciliation(CHANNELS, [
      "gid://shopify/Publication/1",
      "gid://shopify/Publication/3",
    ]);
    expect(plan.toPublish.map((c) => c.name)).toEqual(["Nur Goods Headless Store"]);
    expect(plan.toUnpublish).toEqual([]);
    expect(plan.compliant).toBe(false);
  });

  it("is idempotent once a product is compliant", () => {
    const plan = planPublicationReconciliation(CHANNELS, [
      "gid://shopify/Publication/1",
      "gid://shopify/Publication/3",
      "gid://shopify/Publication/4",
    ]);
    expect(plan.toPublish).toEqual([]);
    expect(plan.toUnpublish).toEqual([]);
    expect(plan.compliant).toBe(true);
  });

  it("unpublishes point of sale and unknown channels during reconciliation", () => {
    const plan = planPublicationReconciliation(
      [...CHANNELS, { id: "gid://shopify/Publication/9", name: "Some Marketplace" }],
      [
        "gid://shopify/Publication/1",
        "gid://shopify/Publication/2",
        "gid://shopify/Publication/3",
        "gid://shopify/Publication/4",
        "gid://shopify/Publication/9",
      ],
    );
    expect(plan.toPublish).toEqual([]);
    expect(plan.toUnpublish.map((c) => c.name)).toEqual(["Point of Sale", "Some Marketplace"]);
  });

  it("removes the Online Store only while the deliberate opt out is in force", () => {
    const kept = planPublicationReconciliation(CHANNELS, ["gid://shopify/Publication/1"]);
    expect(kept.toUnpublish).toEqual([]);
    expect(kept.toPublish.map((c) => c.name).sort()).toEqual([
      "Nur Goods Headless Store",
      "Shop",
    ]);

    const optedOut = planPublicationReconciliation(CHANNELS, ["gid://shopify/Publication/1"], {
      ...DEFAULT_PUBLICATION_POLICY,
      includeOnlineStore: false,
    });
    expect(optedOut.toUnpublish.map((c) => c.name)).toEqual(["Online Store"]);
  });

  it("refuses outright if an unapproved channel reaches the publish call", () => {
    expect(() => assertOnlyApprovedChannels([{ id: "2", name: "Point of Sale" }])).toThrow(
      /Refusing to publish/,
    );
    expect(() => assertOnlyApprovedChannels([{ id: "9", name: "Some Marketplace" }])).toThrow();
    expect(() => assertOnlyApprovedChannels([{ id: "1", name: "Online Store" }])).not.toThrow();
    expect(() =>
      assertOnlyApprovedChannels([{ id: "1", name: "Online Store" }], {
        ...DEFAULT_PUBLICATION_POLICY,
        includeOnlineStore: false,
      }),
    ).toThrow();
    expect(() =>
      assertOnlyApprovedChannels([{ id: "4", name: "Nur Goods Headless Store" }]),
    ).not.toThrow();
    expect(() => assertOnlyApprovedChannels([{ id: "3", name: "Shop" }])).not.toThrow();
    expect(() =>
      assertOnlyApprovedChannels([{ id: "3", name: "Shop" }], {
        ...DEFAULT_PUBLICATION_POLICY,
        includeShopChannel: false,
      }),
    ).toThrow();
  });

  it("treats a Shop refusal as an exception and never as drift on the other surfaces", () => {
    const plan = planPublicationReconciliation(CHANNELS, [
      "gid://shopify/Publication/1",
      "gid://shopify/Publication/4",
    ]);
    expect(plan.toPublish.map((c) => c.name)).toEqual(["Shop"]);

    const drift = evaluateCompliance(plan);
    expect(drift.compliant).toBe(false);
    expect(drift.missingRequired).toEqual(["Shop"]);
    expect(drift.shopException).toBeNull();

    const exception = evaluateCompliance(plan, {
      shopIneligibleReason: "Product is not eligible for Shop",
    });
    expect(exception.missingRequired).toEqual([]);
    expect(exception.shopException).toBe("Product is not eligible for Shop");
    expect(exception.compliant).toBe(true);
    expect(exception.disallowedPresent).toEqual([]);
  });
});
