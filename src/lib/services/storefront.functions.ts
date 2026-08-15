import { createServerFn } from "@tanstack/react-start";
import type {
  StorefrontCollection,
  StorefrontFacets,
  StorefrontProductCard,
  StorefrontProductDetail,
  StorefrontSort,
} from "@/lib/public-api/storefront.server";

/**
 * Public, read only storefront reads. Row level security keeps these limited to
 * active synced store records and published content, so no session is required
 * and server rendering stays safe.
 */

const SORTS: StorefrontSort[] = ["featured", "price_asc", "price_desc", "newest", "title_desc"];

export interface StorefrontListInput {
  query?: string | undefined;
  productType?: string | undefined;
  collectionHandle?: string | undefined;
  tag?: string | undefined;
  sort?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export const listStorefrontProductsFn = createServerFn({ method: "GET" })
  .inputValidator((input: StorefrontListInput | undefined) => {
    const value = input ?? {};
    const sort = SORTS.includes(value.sort as StorefrontSort)
      ? (value.sort as StorefrontSort)
      : ("featured" as const);
    return {
      query: value.query ? String(value.query).slice(0, 120) : undefined,
      productType: value.productType ? String(value.productType).slice(0, 120) : undefined,
      collectionHandle: value.collectionHandle
        ? String(value.collectionHandle).slice(0, 120)
        : undefined,
      tag: value.tag ? String(value.tag).slice(0, 120) : undefined,
      sort,
      limit: value.limit ? Number(value.limit) : undefined,
      offset: value.offset ? Number(value.offset) : undefined,
    };
  })
  .handler(
    async ({
      data,
    }): Promise<{ items: StorefrontProductCard[]; total: number; hasMore: boolean }> => {
      const { listStorefrontProducts } = await import("@/lib/public-api/storefront.server");
      return listStorefrontProducts(data);
    },
  );

export const listStorefrontFacetsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<StorefrontFacets> => {
    const { listStorefrontFacets } = await import("@/lib/public-api/storefront.server");
    return listStorefrontFacets();
  },
);

export const listStorefrontCollectionsFn = createServerFn({ method: "GET" })
  .inputValidator((input: { withProductsOnly?: boolean } | undefined) => ({
    withProductsOnly: Boolean(input?.withProductsOnly),
  }))
  .handler(async ({ data }): Promise<StorefrontCollection[]> => {
    const { listStorefrontCollections } = await import("@/lib/public-api/storefront.server");
    return listStorefrontCollections({ withProductsOnly: data.withProductsOnly });
  });

export const getStorefrontCollectionFn = createServerFn({ method: "GET" })
  .inputValidator((input: { handle: string }) => ({ handle: String(input.handle).slice(0, 120) }))
  .handler(async ({ data }): Promise<StorefrontCollection | null> => {
    const { getStorefrontCollection } = await import("@/lib/public-api/storefront.server");
    return getStorefrontCollection(data.handle);
  });

export const getStorefrontProductFn = createServerFn({ method: "GET" })
  .inputValidator((input: { handle: string }) => ({ handle: String(input.handle).slice(0, 120) }))
  .handler(async ({ data }): Promise<StorefrontProductDetail | null> => {
    const { getStorefrontProduct } = await import("@/lib/public-api/storefront.server");
    return getStorefrontProduct(data.handle);
  });
