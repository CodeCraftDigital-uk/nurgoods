import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertStorefrontUrl, isCheckoutInfrastructureUrl } from "./hosts";

describe("storefront link protection", () => {
  it("refuses shopper links to the checkout host", () => {
    expect(() => assertStorefrontUrl("https://shop.nurgoods.com/products/turtle")).toThrow(
      /checkout infrastructure/,
    );
    expect(isCheckoutInfrastructureUrl("https://shop.nurgoods.com/cart")).toBe(true);
  });

  it("allows real NUR GOODS links", () => {
    expect(assertStorefrontUrl("https://nurgoods.com/shop")).toBe("https://nurgoods.com/shop");
    expect(assertStorefrontUrl("/shop/turtle-night-light")).toBe("/shop/turtle-night-light");
    expect(isCheckoutInfrastructureUrl("/shop")).toBe(false);
  });
});

/**
 * The checkout host may only appear in checkout plumbing and admin guidance.
 * Customer facing components and public routes must never hardcode it.
 */
const ALLOWED = new Set([
  "src/lib/hosts.ts",
  "src/lib/hosts.test.ts",
  "src/lib/services/shopify-storefront.server.ts",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("customer facing code never hardcodes the checkout host", () => {
  it("finds no shop host in public components or public routes", () => {
    const files = [
      ...walk("src/components/public"),
      ...walk("src/routes").filter(
        (file) => !file.includes("_authenticated") && !file.includes("admin."),
      ),
      ...walk("src/lib/basket"),
    ];
    const offenders = files.filter(
      (file) => !ALLOWED.has(file.replace(/\\/g, "/")) && readFileSync(file, "utf8").includes("shop.nurgoods.com"),
    );
    expect(offenders).toEqual([]);
  });
});
