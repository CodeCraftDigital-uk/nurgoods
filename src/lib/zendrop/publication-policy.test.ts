import { describe, expect, it } from "vitest";
import {
  assertNoShopChannel,
  classifyChannel,
  DEFAULT_PUBLICATION_POLICY,
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

  it("publishes to the headless channel only by default", () => {
    const { targets, excluded } = selectPublicationTargets(CHANNELS);
    expect(targets.map((c) => c.name)).toEqual(["Nur Goods Headless Store"]);
    const skipped = excluded.map((e) => e.channel.name);
    expect(skipped).toEqual(
      expect.arrayContaining(["Online Store", "Shop", "Point of Sale"]),
    );
  });

  it("never selects the Shop channel even when an opt in is recorded", () => {
    const { targets } = selectPublicationTargets(CHANNELS, {
      ...DEFAULT_PUBLICATION_POLICY,
      allowShopChannel: true,
      allowPointOfSale: true,
    });
    expect(targets.map((c) => c.name)).toEqual(["Nur Goods Headless Store"]);
  });

  it("can add the Online Store back only through a deliberate opt in", () => {
    const { targets } = selectPublicationTargets(CHANNELS, {
      ...DEFAULT_PUBLICATION_POLICY,
      includeOnlineStore: true,
    });
    expect(targets.map((c) => c.name)).toEqual([
      "Online Store",
      "Nur Goods Headless Store",
    ]);
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
    expect(plan.toUnpublish.map((c) => c.name)).toEqual(["Online Store", "Shop"]);
    expect(plan.compliant).toBe(false);
  });

  it("is idempotent once a product is compliant", () => {
    const plan = planPublicationReconciliation(CHANNELS, ["gid://shopify/Publication/4"]);
    expect(plan.toPublish).toEqual([]);
    expect(plan.toUnpublish).toEqual([]);
    expect(plan.compliant).toBe(true);
  });

  it("unpublishes point of sale and unknown channels during reconciliation", () => {
    const plan = planPublicationReconciliation(
      [...CHANNELS, { id: "gid://shopify/Publication/9", name: "Some Marketplace" }],
      [
        "gid://shopify/Publication/2",
        "gid://shopify/Publication/4",
        "gid://shopify/Publication/9",
      ],
    );
    expect(plan.toPublish).toEqual([]);
    expect(plan.toUnpublish.map((c) => c.name)).toEqual(["Point of Sale", "Some Marketplace"]);
  });

  it("keeps the Online Store only while the deliberate override is in force", () => {
    const withOverride = planPublicationReconciliation(CHANNELS, ["gid://shopify/Publication/1"], {
      ...DEFAULT_PUBLICATION_POLICY,
      includeOnlineStore: true,
    });
    expect(withOverride.toUnpublish).toEqual([]);
    const withoutOverride = planPublicationReconciliation(CHANNELS, ["gid://shopify/Publication/1"]);
    expect(withoutOverride.toUnpublish.map((c) => c.name)).toEqual(["Online Store"]);
  });

  it("refuses outright if the Shop channel ever reaches the publish call", () => {
    expect(() => assertNoShopChannel([{ id: "3", name: "Shop" }])).toThrow(/Shop channel/);
    expect(() => assertNoShopChannel([{ id: "2", name: "Point of Sale" }])).toThrow();
    expect(() => assertNoShopChannel([{ id: "4", name: "Nur Goods Headless Store" }])).not.toThrow();
  });
});
