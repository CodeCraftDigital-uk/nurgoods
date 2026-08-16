import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { PublicShell } from "@/components/public/PublicShell";
import { Breadcrumbs } from "@/components/public/Breadcrumbs";
import { ProductCard, ProductCardSkeleton } from "@/components/public/ProductCard";
import { BRAND } from "@/lib/brand";
import {
  listStorefrontCollectionsFn,
  listStorefrontFacetsFn,
  listStorefrontProductsFn,
} from "@/lib/services/storefront.functions";

interface ShopSearch {
  q?: string | undefined;
  /** Canonical NUR GOODS category slug. */
  category?: string | undefined;
  collection?: string | undefined;
  tag?: string | undefined;
  sort?: string | undefined;
}

type StorefrontCard = Awaited<ReturnType<typeof listStorefrontProductsFn>>["items"][number];

const SORT_OPTIONS = [
  { value: "featured", label: "Featured" },
  { value: "price_asc", label: "Price, low to high" },
  { value: "price_desc", label: "Price, high to low" },
  { value: "newest", label: "Recently updated" },
  { value: "title_desc", label: "Name, Z to A" },
] as const;

export const Route = createFileRoute("/shop/")({
  validateSearch: (search: Record<string, unknown>): ShopSearch => ({
    q: typeof search["q"] === "string" && search["q"] ? search["q"].slice(0, 120) : undefined,
    category:
      typeof search["category"] === "string" && search["category"]
        ? search["category"].slice(0, 120)
        : undefined,
    collection:
      typeof search["collection"] === "string" && search["collection"]
        ? search["collection"].slice(0, 120)
        : undefined,
    tag:
      typeof search["tag"] === "string" && search["tag"] ? search["tag"].slice(0, 120) : undefined,
    sort: typeof search["sort"] === "string" && search["sort"] ? search["sort"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Shop the range | NUR GOODS" },
      {
        name: "description",
        content:
          "Browse the full NUR GOODS range. Search, filter and compare considered everyday goods, then complete your order on the main store.",
      },
      { property: "og:title", content: "Shop the range | NUR GOODS" },
      {
        property: "og:description",
        content: "Browse and search the full NUR GOODS range of considered everyday goods.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${BRAND.siteUrl}/shop` },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: `${BRAND.siteUrl}/shop` }],
  }),
  component: ShopIndex,
});

function ShopIndex() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/shop/" });
  const [term, setTerm] = useState(search.q ?? "");

  useEffect(() => {
    setTerm(search.q ?? "");
  }, [search.q]);

  const fetchProducts = useServerFn(listStorefrontProductsFn);
  const fetchFacets = useServerFn(listStorefrontFacetsFn);
  const fetchCollections = useServerFn(listStorefrontCollectionsFn);

  const PAGE_SIZE = 48;
  const [offset, setOffset] = useState(0);
  const [loaded, setLoaded] = useState<StorefrontCard[]>([]);

  // Any change of search or filter starts the range again from the first page.
  useEffect(() => {
    setOffset(0);
    setLoaded([]);
  }, [search.q, search.category, search.collection, search.tag, search.sort]);

  const products = useQuery({
    queryKey: [
      "storefront-products",
      search.q ?? "",
      search.category ?? "",
      search.collection ?? "",
      search.tag ?? "",
      search.sort ?? "featured",
      offset,
    ],
    queryFn: () =>
      fetchProducts({
        data: {
          query: search.q,
          category: search.category,
          collectionHandle: search.collection,
          tag: search.tag,
          sort: search.sort,
          limit: PAGE_SIZE,
          offset,
        },
      }),
    retry: false,
  });

  const pageItems = products.data?.items;
  useEffect(() => {
    if (!pageItems) return;
    setLoaded((previous) => {
      const seen = new Set(previous.map((item) => item.id));
      const additions = pageItems.filter((item) => !seen.has(item.id));
      return additions.length ? [...previous, ...additions] : previous;
    });
  }, [pageItems]);



  const collections = useQuery({
    queryKey: ["storefront-collection-filters"],
    queryFn: () => fetchCollections({ data: { withProductsOnly: true } }),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const facets = useQuery({
    queryKey: ["storefront-facets"],
    queryFn: () => fetchFacets({}),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const setSearch = (next: Partial<ShopSearch>) => {
    void navigate({
      search: ((prev: ShopSearch) => {
        const merged = { ...prev, ...next };
        return {
          q: merged.q || undefined,
          category: merged.category || undefined,
          collection: merged.collection || undefined,
          tag: merged.tag || undefined,
          sort: merged.sort && merged.sort !== "featured" ? merged.sort : undefined,
        };
      }) as never,
      replace: true,
    });
  };

  const items = loaded;
  const total = products.data?.total ?? items.length;
  const hasMore = items.length > 0 && items.length < total;

  const tags = facets.data?.tags ?? [];
  const categories = facets.data?.categories ?? [];
  const collectionItems = [...(collections.data ?? [])].sort(
    (a, b) => b.product_count - a.product_count || a.title.localeCompare(b.title),
  );
  const filtered = Boolean(search.q || search.category || search.collection || search.tag);

  return (
    <PublicShell>
      <div className="mx-auto w-full max-w-7xl px-5 pt-12 sm:px-8 sm:pt-16">
        <Breadcrumbs items={[{ label: "Shop", href: "/shop" }]} />
        <h1 className="mt-4 font-display text-4xl leading-tight text-foreground sm:text-5xl">
          Shop the range
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
          Everything here is listed from the live {BRAND.name} store. Checkout and delivery are
          handled on the store itself, so what you see is always what is actually available.
        </p>

        <form
          role="search"
          className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch({ q: term.trim() });
          }}
        >
          <div className="flex-1">
            <label htmlFor="shop-search" className="sr-only">
              Search products
            </label>
            <input
              id="shop-search"
              type="search"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Search products"
              className="h-12 w-full rounded-2xl border border-input bg-surface px-4 text-sm shadow-[var(--shadow-card)] focus:border-brand focus:ring-4 focus:ring-brand/15 text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1 sm:flex-none">
              <label htmlFor="shop-sort" className="sr-only">
                Sort products
              </label>
              <select
                id="shop-sort"
                value={search.sort ?? "featured"}
                onChange={(event) => setSearch({ sort: event.target.value })}
                className="h-12 w-full rounded-2xl border border-input bg-surface px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="inline-flex h-12 shrink-0 items-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Search
            </button>
          </div>
        </form>

        {categories.length > 0 ? (
          <div className="mt-6">
            <h2 className="text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">
              Departments
            </h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSearch({ category: undefined })}
                aria-pressed={!search.category}
                className={`inline-flex min-h-9 items-center rounded-full border px-3.5 text-xs transition-colors ${
                  search.category
                    ? "border-border bg-surface text-muted-foreground hover:border-brand/40 hover:text-foreground"
                    : "border-transparent bg-primary text-primary-foreground shadow-sm"
                }`}
              >
                All
              </button>
              {categories.slice(0, 18).map((category) => (
                <button
                  key={category.slug}
                  type="button"
                  onClick={() =>
                    setSearch({
                      category: search.category === category.slug ? undefined : category.slug,
                    })
                  }
                  aria-pressed={search.category === category.slug}
                  className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-xs transition-colors ${
                    search.category === category.slug
                      ? "border-transparent bg-primary text-primary-foreground shadow-sm"
                      : "border-border bg-surface text-muted-foreground hover:border-brand/40 hover:text-foreground"
                  }`}
                >
                  {category.name}
                  <span className="text-[0.65rem] text-muted-foreground">{category.products}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {collectionItems.length > 0 ? (
          <div className="mt-6">
            <h2 className="text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">
              Collections
            </h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSearch({ collection: undefined })}
                aria-pressed={!search.collection}
                className={`inline-flex min-h-9 items-center rounded-full border px-3.5 text-xs transition-colors ${
                  search.collection
                    ? "border-border bg-surface text-muted-foreground hover:border-brand/40 hover:text-foreground"
                    : "border-transparent bg-primary text-primary-foreground shadow-sm"
                }`}
              >
                All
              </button>
              {collectionItems.map((collection) => (
                <button
                  key={collection.handle}
                  type="button"
                  onClick={() => setSearch({ collection: collection.handle })}
                  aria-pressed={search.collection === collection.handle}
                  className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-xs transition-colors ${
                    search.collection === collection.handle
                      ? "border-transparent bg-primary text-primary-foreground shadow-sm"
                      : "border-border bg-surface text-muted-foreground hover:border-brand/40 hover:text-foreground"
                  }`}
                >
                  {collection.title}
                  <span className="text-[0.65rem] text-muted-foreground">
                    {collection.product_count}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {tags.length > 0 ? (
          <div className="mt-5">
            <h2 className="text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">
              Popular tags
            </h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {search.tag ? (
                <button
                  type="button"
                  onClick={() => setSearch({ tag: undefined })}
                  className="inline-flex min-h-9 items-center rounded-full border-transparent bg-secondary px-3.5 text-xs font-medium text-secondary-foreground"
                >
                  Clear tag
                </button>
              ) : null}
              {tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setSearch({ tag: search.tag === tag ? undefined : tag })}
                  aria-pressed={search.tag === tag}
                  className={`inline-flex min-h-9 items-center rounded-full border px-3.5 text-xs transition-colors ${
                    search.tag === tag
                      ? "border-transparent bg-primary text-primary-foreground shadow-sm"
                      : "border-border bg-surface text-muted-foreground hover:border-brand/40 hover:text-foreground"
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mx-auto w-full max-w-7xl px-5 pb-8 pt-10 sm:px-8">
        {products.isLoading ? (
          <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
              <li key={index}>
                <ProductCardSkeleton />
              </li>
            ))}
          </ul>
        ) : products.isError ? (
          <div className="rounded-xl border border-border/70 p-10 text-center">
            <h2 className="font-display text-xl text-foreground">Products cannot be shown</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              The range could not be loaded right now. You can browse everything on the store while
              we look into it.
            </p>
            <a
              href={BRAND.storeUrl}
              className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground"
            >
              Go to the store
            </a>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <h2 className="font-display text-xl text-foreground">
              {filtered ? "Nothing matched that search" : "The range is being prepared"}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              {filtered
                ? "Try a shorter search or clear the filters to see everything."
                : "Products appear here as soon as the store range is listed. Everything is already available to buy on the store."}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              {filtered ? (
                <button
                  type="button"
                  onClick={() =>
                    setSearch({ q: undefined, collection: undefined, tag: undefined })
                  }
                  className="inline-flex min-h-11 items-center rounded-lg border border-input px-5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                >
                  Clear filters
                </button>
              ) : null}
              <a
                href={BRAND.storeUrl}
                className="inline-flex min-h-11 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Shop {BRAND.name}
              </a>
            </div>
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              Showing {items.length} of {total} product{total === 1 ? "" : "s"}
            </p>
            <ul className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
              {items.map((product, index) => (
                <li key={product.id}>
                  <ProductCard product={product} eager={index < 4} />
                </li>
              ))}
            </ul>
            {hasMore ? (
              <div className="mt-10 flex justify-center">
                <button
                  type="button"
                  onClick={() => setOffset(items.length)}
                  disabled={products.isFetching}
                  className="inline-flex min-h-11 items-center rounded-lg border border-input px-6 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60"
                >
                  {products.isFetching ? "Loading" : "Load more products"}
                </button>
              </div>
            ) : null}
          </>
        )}


        <div className="mt-14 glass-card rounded-3xl p-7 sm:p-9">
          <h2 className="font-display text-2xl text-foreground">Browse by collection</h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Collections group the range by how the products are used, which is often a faster way
            in than searching.
          </p>
          <Link
            to="/collections"
            className="mt-5 inline-flex min-h-11 items-center rounded-lg border border-input px-5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            See collections
          </Link>
        </div>
      </div>
    </PublicShell>
  );
}
