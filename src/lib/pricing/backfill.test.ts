/**
 * Cover for the catalogue pricing backfill.
 *
 * Two properties matter more than anything else here. The walk must be able to
 * stop and start again without repeating or skipping a product, and it must
 * never put stock on sale: it only ever corrects prices, on drafts by default.
 */
import { describe, expect, it } from "vitest";
import { runBackfillPassWith, type BackfillDeps } from "./backfill.server";

interface Fixture {
  deps: BackfillDeps;
  /** Every product id handed to the pricing authority, in order. */
  seen: string[];
  repriceCalls: Array<{ ids: string[]; dryRun: boolean }>;
  listCalls: Array<{ cursor: string; limit: number; scope: string }>;
}

function makeFixture(
  catalogue: Array<{ id: string; status: string; variants: number }>,
  options: { failFrom?: string } = {},
): Fixture {
  let state: any = null;
  const seen: string[] = [];
  const repriceCalls: Fixture["repriceCalls"] = [];
  const listCalls: Fixture["listCalls"] = [];

  const deps: BackfillDeps = {
    async readState() {
      return state;
    },
    async writeState(next) {
      state = { ...next };
    },
    async listProducts(cursor, limit, scope) {
      listCalls.push({ cursor, limit, scope });
      return catalogue
        .filter((product) => (scope === "draft" ? product.status === "draft" : true))
        .filter((product) => product.id > cursor)
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, limit)
        .map((product) => product.id);
    },
    async reprice(ids, dryRun) {
      repriceCalls.push({ ids, dryRun });
      seen.push(...ids);
      let variants = 0;
      let repriced = 0;
      let failed = 0;
      for (const id of ids) {
        const product = catalogue.find((entry) => entry.id === id)!;
        variants += product.variants;
        if (options.failFrom && id >= options.failFrom) failed += product.variants;
        else repriced += product.variants;
      }
      return { products: ids.length, variants, inSync: 0, repriced, held: 0, failed, examples: [] };
    },
  };

  return { deps, seen, repriceCalls, listCalls };
}

const CATALOGUE = [
  { id: "gid://shopify/Product/1", status: "draft", variants: 2 },
  { id: "gid://shopify/Product/2", status: "draft", variants: 1 },
  { id: "gid://shopify/Product/3", status: "active", variants: 4 },
  { id: "gid://shopify/Product/4", status: "draft", variants: 3 },
];

describe("backfill scope", () => {
  it("walks drafts only by default, so nothing on sale is touched", async () => {
    const fixture = makeFixture(CATALOGUE);
    await runBackfillPassWith(fixture.deps, { products: 10 });
    expect(fixture.listCalls[0]?.scope).toBe("draft");
    expect(fixture.seen).not.toContain("gid://shopify/Product/3");
    expect(fixture.seen).toHaveLength(3);
  });

  it("includes live products only when the operator asks for the whole catalogue", async () => {
    const fixture = makeFixture(CATALOGUE);
    await runBackfillPassWith(fixture.deps, { scope: "all", products: 10 });
    expect(fixture.seen).toContain("gid://shopify/Product/3");
  });
});

describe("preview and apply", () => {
  it("previews without writing prices to the store", async () => {
    const fixture = makeFixture(CATALOGUE);
    const pass = await runBackfillPassWith(fixture.deps, { products: 10 });
    expect(pass.mode).toBe("preview");
    expect(fixture.repriceCalls.every((call) => call.dryRun)).toBe(true);
    expect(pass.message).toMatch(/no product status or channel was changed/i);
  });

  it("writes prices only on an explicit apply", async () => {
    const fixture = makeFixture(CATALOGUE);
    const pass = await runBackfillPassWith(fixture.deps, { mode: "apply", products: 10 });
    expect(pass.mode).toBe("apply");
    expect(fixture.repriceCalls.every((call) => call.dryRun === false)).toBe(true);
  });

  it("reports repriced, already correct, held and failed separately", async () => {
    const fixture = makeFixture(CATALOGUE, { failFrom: "gid://shopify/Product/4" });
    const pass = await runBackfillPassWith(fixture.deps, { mode: "apply", products: 10 });
    // Product 4 has three variants and its write did not verify on read back.
    expect(pass.failed).toBe(3);
    expect(pass.corrected).toBe(3);
    expect(pass.alreadyCorrect).toBe(0);
    expect(pass.held).toBe(0);
    // A failed write is never counted as priced.
    expect(pass.totals.priced).toBe(3);
  });
});

describe("safe resume", () => {
  it("resumes on the next unseen product and never repeats a page", async () => {
    const fixture = makeFixture(CATALOGUE);
    const first = await runBackfillPassWith(fixture.deps, { products: 2 });
    expect(first.finishedFullPass).toBe(false);
    expect(first.cursor).toBe("gid://shopify/Product/2");

    const second = await runBackfillPassWith(fixture.deps, { products: 2 });
    expect(second.finishedFullPass).toBe(true);
    expect(second.cursor).toBeNull();

    expect(fixture.seen).toEqual([
      "gid://shopify/Product/1",
      "gid://shopify/Product/2",
      "gid://shopify/Product/4",
    ]);
    expect(new Set(fixture.seen).size).toBe(fixture.seen.length);
  });

  it("carries running totals across passes", async () => {
    const fixture = makeFixture(CATALOGUE);
    const first = await runBackfillPassWith(fixture.deps, { products: 2 });
    const second = await runBackfillPassWith(fixture.deps, { products: 2 });
    expect(first.totals.seen).toBe(3);
    expect(second.totals.seen).toBe(6);
  });

  it("does not walk the catalogue again once it has finished", async () => {
    const fixture = makeFixture(CATALOGUE);
    await runBackfillPassWith(fixture.deps, { products: 10 });
    const again = await runBackfillPassWith(fixture.deps, { products: 10 });
    expect(again.products).toBe(0);
    expect(fixture.seen).toHaveLength(3);
  });
});
