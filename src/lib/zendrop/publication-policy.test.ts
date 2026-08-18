import { describe, expect, it } from "vitest";
import {
  assertNoShopChannel,
  classifyChannel,
  DEFAULT_PUBLICATION_POLICY,
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

  it("never selects the Shop channel by default", () => {
    const { targets, excluded } = selectPublicationTargets(CHANNELS);
    expect(targets.map((c) => c.name)).toEqual(["Online Store", "Nur Goods Headless Store"]);
    expect(excluded.map((e) => e.channel.name)).toContain("Shop");
  });

  it("never selects the Shop channel even when an opt in is recorded", () => {
    const { targets } = selectPublicationTargets(CHANNELS, {
      ...DEFAULT_PUBLICATION_POLICY,
      allowShopChannel: true,
    });
    expect(targets.map((c) => c.name)).not.toContain("Shop");
  });

  it("can drop the Online Store once headless only checkout is proven", () => {
    const { targets, excluded } = selectPublicationTargets(CHANNELS, {
      includeOnlineStore: false,
      allowShopChannel: false,
    });
    expect(targets.map((c) => c.name)).toEqual(["Nur Goods Headless Store"]);
    expect(excluded.map((e) => e.channel.name)).toContain("Online Store");
  });

  it("excludes channels it does not recognise rather than guessing", () => {
    const { targets } = selectPublicationTargets([
      ...CHANNELS,
      { id: "gid://shopify/Publication/9", name: "Some Marketplace" },
    ]);
    expect(targets.map((c) => c.name)).not.toContain("Some Marketplace");
  });

  it("refuses outright if the Shop channel ever reaches the publish call", () => {
    expect(() => assertNoShopChannel([{ id: "3", name: "Shop" }])).toThrow(/Shop channel/);
    expect(() => assertNoShopChannel([{ id: "4", name: "Nur Goods Headless Store" }])).not.toThrow();
  });
});
