/**
 * The mirror is a copy of the store, and a stale copy must never be allowed to
 * decide what gets priced or what a customer is shown. These are the two ways
 * that went wrong in production.
 */
import { describe, expect, it } from "vitest";
import {
  reconcileCatalogueWith,
  selectBackfillProductIds,
  type LiveCataloguePage,
  type LiveProduct,
} from "./catalogue-reconcile.server";

describe("backfill scope comes from the live store", () => {
  it("does not let a stale mirror row marked active exclude a live draft product", () => {
    // The mirror still believes this product is active. The store says draft.
    const live = [
      { shopifyProductId: "gid://shopify/Product/1", status: "draft" },
      { shopifyProductId: "gid://shopify/Product/2", status: "active" },
    ];

    const selected = selectBackfillProductIds(live, { scope: "draft", cursor: "", limit: 10 });

    expect(selected).toEqual(["gid://shopify/Product/1"]);
  });

  it("walks the whole live catalogue when the scope is widened", () => {
    const live = [
      { shopifyProductId: "gid://shopify/Product/1", status: "draft" },
      { shopifyProductId: "gid://shopify/Product/2", status: "active" },
    ];
    expect(selectBackfillProductIds(live, { scope: "all", cursor: "", limit: 10 })).toHaveLength(2);
  });

  it("resumes after the cursor without repeating a page", () => {
    const live = [
      { shopifyProductId: "gid://shopify/Product/1", status: "draft" },
      { shopifyProductId: "gid://shopify/Product/2", status: "draft" },
    ];
    expect(
      selectBackfillProductIds(live, {
        scope: "draft",
        cursor: "gid://shopify/Product/1",
        limit: 10,
      }),
    ).toEqual(["gid://shopify/Product/2"]);
  });
});

describe("reconciliation makes the store the authority", () => {
  /** A mirror and a projection that have both gone stale, as in production. */
  function staleWorld() {
    const mirror = new Map<string, { status: string; price: number | null }>([
      ["gid://shopify/Product/1", { status: "active", price: 1.99 }],
    ]);
    const projection = new Map<string, number | null>([["gid://shopify/Product/1", 1.99]]);
    return { mirror, projection };
  }

  const liveProduct: LiveProduct = {
    shopifyProductId: "gid://shopify/Product/1",
    title: "Marinade injector",
    status: "draft",
    variants: [
      {
        id: "gid://shopify/ProductVariant/11",
        title: "Default",
        price: 12.99,
        compareAtPrice: null,
      },
    ],
  };

  function depsFor(world: ReturnType<typeof staleWorld>, products: LiveProduct[]) {
    const page: LiveCataloguePage = { products, cursor: null, hasNextPage: false };
    return {
      fetchPage: async () => page,
      async writeProduct(product: LiveProduct) {
        world.mirror.set(product.shopifyProductId, {
          status: product.status,
          price: product.variants[0]?.price ?? null,
        });
      },
      async refreshProjection() {
        // The projection is rebuilt from the mirror, exactly as the database
        // function does.
        for (const [id, row] of world.mirror) world.projection.set(id, row.price);
      },
    };
  }

  it("replaces the stale public price of 1.99 with the store price of 12.99", async () => {
    const world = staleWorld();

    const report = await reconcileCatalogueWith(depsFor(world, [liveProduct]));

    expect(report.products).toBe(1);
    expect(report.projectionRefreshed).toBe(true);
    expect(world.projection.get("gid://shopify/Product/1")).toBe(12.99);
  });

  it("corrects a mirror status that the store no longer agrees with", async () => {
    const world = staleWorld();

    const report = await reconcileCatalogueWith(depsFor(world, [liveProduct]));

    expect(world.mirror.get("gid://shopify/Product/1")?.status).toBe("draft");
    expect(report.draft).toBe(1);
    expect(report.active).toBe(0);
  });

  it("leaves the projection alone when the walk did not reach the end", async () => {
    const world = staleWorld();
    const report = await reconcileCatalogueWith(
      {
        fetchPage: async () => ({ products: [liveProduct], cursor: "next", hasNextPage: true }),
        writeProduct: async () => {},
        refreshProjection: async () => {
          throw new Error("the projection must not be rebuilt from a partial walk");
        },
      },
      { maxPages: 1 },
    );

    expect(report.finished).toBe(false);
    expect(report.projectionRefreshed).toBe(false);
    expect(world.projection.get("gid://shopify/Product/1")).toBe(1.99);
  });
});
