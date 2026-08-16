import { createServerFn } from "@tanstack/react-start";
import type {
  CatalogueSearchResult,
  CatalogueSort,
  CatalogueSuggestion,
} from "@/lib/public-api/catalogue-search.server";

/**
 * Public entry points onto the single catalogue search service. Row level
 * security limits reads to active synced store records, and the service itself
 * removes suppressed duplicate listings, so no session is required.
 */

const SORTS: CatalogueSort[] = [
  "relevance",
  "featured",
  "price_asc",
  "price_desc",
  "newest",
  "title_desc",
];

export interface CatalogueSearchInput {
  query?: string | undefined;
  category?: string | undefined;
  collectionHandle?: string | undefined;
  tag?: string | undefined;
  priceMin?: number | undefined;
  priceMax?: number | undefined;
  availableOnly?: boolean | undefined;
  sort?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

function text(value: unknown, max = 120): string | undefined {
  return typeof value === "string" && value.trim() ? String(value).slice(0, max) : undefined;
}

function num(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export const searchCatalogueFn = createServerFn({ method: "GET" })
  .inputValidator((input: CatalogueSearchInput | undefined) => {
    const value = input ?? {};
    return {
      query: text(value.query),
      category: text(value.category),
      collectionHandle: text(value.collectionHandle, 255),
      tag: text(value.tag),
      priceMin: num(value.priceMin),
      priceMax: num(value.priceMax),
      availableOnly: Boolean(value.availableOnly),
      sort: SORTS.includes(value.sort as CatalogueSort) ? (value.sort as CatalogueSort) : undefined,
      limit: num(value.limit),
      offset: num(value.offset),
    };
  })
  .handler(async ({ data }): Promise<CatalogueSearchResult> => {
    const { searchCatalogue } = await import("@/lib/public-api/catalogue-search.server");
    return searchCatalogue(data);
  });

export const suggestCatalogueFn = createServerFn({ method: "GET" })
  .inputValidator((input: { query?: string } | undefined) => ({
    query: text(input?.query) ?? "",
  }))
  .handler(async ({ data }): Promise<CatalogueSuggestion[]> => {
    if (!data.query) return [];
    const { suggestCatalogue } = await import("@/lib/public-api/catalogue-search.server");
    return suggestCatalogue(data.query);
  });
