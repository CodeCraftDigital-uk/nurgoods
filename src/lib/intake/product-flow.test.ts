import { describe, expect, it } from "vitest";
import { activateForStorefront, type ActivationPort } from "./activation.server";
import { decideRequeue, materialIntakeFingerprint } from "./fingerprint";
import { validateIntake } from "./validate";
import type { IntakePolicy } from "./types";

/**
 * Product flow proofs.
 *
 * Zendrop catalogue to NUR GOODS staging draft, then deterministic gates, then
 * store activation as the final publication step. Every case here is a rule the
 * platform must never quietly relax.
 */

const POLICY: IntakePolicy = {
  require_image: true,
  require_purchasable_variant: true,
  require_valid_price: true,
  require_description: true,
} as IntakePolicy;

function bundle(overrides: { product?: Record<string, unknown>; variants?: any[] } = {}) {
  return {
    product: {
      shopify_product_id: "gid://shopify/Product/12345",
      title: "Compact Desk Humidifier",
      handle: "compact-desk-humidifier",
      status: "active",
      currency: "GBP",
      description:
        "A quiet desk humidifier with a two litre tank, adjustable mist output and an automatic shut off.",
      vendor: "NUR GOODS",
      product_type: "Home",
      tags: ["home", "desk"],
      ...(overrides.product ?? {}),
    },
    media: [{ url: "https://cdn.example.com/humidifier.jpg" }],
    variants: overrides.variants ?? [
      { title: "Default", price: 24.99, available_for_sale: true, selected_options: [] },
    ],
  } as any;
}

describe("intake gates", () => {
  it("accepts a supplier origin draft as a staging record", () => {
    const outcome = validateIntake(bundle({ product: { status: "draft" } }), POLICY, { origin: "supplier" });
    expect(outcome.failedCodes).not.toContain("eligible_status");
    expect(outcome.passed).toBe(true);
  });

  it("rejects a store origin draft", () => {
    const outcome = validateIntake(bundle({ product: { status: "draft" } }), POLICY, { origin: "store" });
    expect(outcome.failedCodes).toContain("eligible_status");
    expect(outcome.passed).toBe(false);
  });

  it("rejects an archived supplier product", () => {
    const outcome = validateIntake(bundle({ product: { status: "archived" } }), POLICY, { origin: "supplier" });
    expect(outcome.failedCodes).toContain("eligible_status");
  });

  it("still fails a supplier draft that is not priced to the rounding rule", () => {
    const outcome = validateIntake(
      bundle({
        product: { status: "draft" },
        variants: [{ title: "Default", price: 24.5, available_for_sale: true, selected_options: [] }],
      }),
      POLICY,
      { origin: "supplier" },
    );
    expect(outcome.failedCodes).toContain("retail_rounding");
    expect(outcome.passed).toBe(false);
  });
});

function makePort(overrides: Partial<ActivationPort> & { status?: string | null } = {}): ActivationPort {
  return {
    async readStatus() {
      return overrides.status ?? "draft";
    },
    async activate() {
      return { ok: true, status: "active", message: "" };
    },
    async publishChannels() {
      return { ok: true, channels: ["Nur Goods Headless Store"], message: "" };
    },
    ...overrides,
  } as ActivationPort;
}

describe("store activation", () => {
  it("activates a supplier draft that has cleared the gates", async () => {
    const result = await activateForStorefront("gid://shopify/Product/1", "supplier", makePort());
    expect(result.ok).toBe(true);
    expect(result.activated).toBe(true);
    expect(result.channels).toContain("Nur Goods Headless Store");
  });

  it("never activates a store managed draft", async () => {
    const result = await activateForStorefront("gid://shopify/Product/1", "store", makePort());
    expect(result.ok).toBe(false);
    expect(result.activated).toBe(false);
  });

  it("does not mark a product live when activation fails", async () => {
    const port = makePort({
      async activate() {
        return { ok: false, status: "draft", message: "The store refused the change" };
      },
    });
    const result = await activateForStorefront("gid://shopify/Product/1", "supplier", port);
    expect(result.ok).toBe(false);
    expect(result.activated).toBe(false);
  });

  it("does not mark a product live when channel publication fails", async () => {
    const port = makePort({
      async publishChannels() {
        return { ok: false, channels: [], message: "The sales channel could not be confirmed" };
      },
    });
    const result = await activateForStorefront("gid://shopify/Product/1", "supplier", port);
    expect(result.ok).toBe(false);
  });
});

describe("material fingerprint", () => {
  const base = {
    title: "Compact Desk Humidifier",
    handle: "compact-desk-humidifier",
    status: "draft",
    vendor: "NUR GOODS",
    productType: "Home",
    tags: ["home"],
    description: "A quiet desk humidifier.",
    variants: [{ id: "gid://shopify/ProductVariant/1", sku: "NG-1", price: 24.99, inventoryQuantity: 5 }],
    images: [{ url: "https://cdn.example.com/a.jpg" }],
  } as any;

  it("ignores price and stock only changes", () => {
    const a = materialIntakeFingerprint(base);
    const b = materialIntakeFingerprint({
      ...base,
      variants: [{ id: "gid://shopify/ProductVariant/1", sku: "NG-1", price: 19.99, inventoryQuantity: 0 }],
    });
    expect(a).toBe(b);
  });

  it("ignores the store publication status so activation does not requeue the product", () => {
    expect(materialIntakeFingerprint(base)).toBe(materialIntakeFingerprint({ ...base, status: "active" }));
  });

  it("changes when the content genuinely changes", () => {
    expect(materialIntakeFingerprint(base)).not.toBe(
      materialIntakeFingerprint({ ...base, title: "Compact Desk Humidifier Pro" }),
    );
  });
});

describe("requeue decisions", () => {
  it("requeues a corrected quarantined record", () => {
    const decision = decideRequeue({
      existing: { state: "quarantined", material_fingerprint: "old", version_fingerprint: "v1" },
      versionFingerprint: "v2",
      materialFingerprint: "new",
      hasVersion: true,
    });
    expect(decision.action).toBe("requeue");
  });

  it("requeues a corrected failed record", () => {
    const decision = decideRequeue({
      existing: { state: "failed", material_fingerprint: "old", version_fingerprint: "v1" },
      versionFingerprint: "v2",
      materialFingerprint: "new",
      hasVersion: true,
    });
    expect(decision.action).toBe("requeue");
  });

  it("leaves a deliberate rejection alone", () => {
    const decision = decideRequeue({
      existing: { state: "rejected", material_fingerprint: "old", version_fingerprint: "v1" },
      versionFingerprint: "v2",
      materialFingerprint: "new",
      hasVersion: true,
    });
    expect(decision.action).toBe("touch");
  });

  it("records content on an already open record without restarting it", () => {
    const decision = decideRequeue({
      existing: { state: "queued", material_fingerprint: "old", version_fingerprint: "v1" },
      versionFingerprint: "v2",
      materialFingerprint: "new",
      hasVersion: true,
    });
    expect(decision.action).toBe("touch");
  });

  it("skips when nothing at all changed", () => {
    const decision = decideRequeue({
      existing: { state: "published_to_storefront", material_fingerprint: "same", version_fingerprint: "v1" },
      versionFingerprint: "v1",
      materialFingerprint: "same",
      hasVersion: true,
    });
    expect(decision.action).toBe("skip");
  });
});
