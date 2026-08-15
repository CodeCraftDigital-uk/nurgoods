import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { PublicShell } from "@/components/public/PublicShell";
import { Breadcrumbs } from "@/components/public/Breadcrumbs";
import { ProductCard, ProductCardSkeleton } from "@/components/public/ProductCard";
import { BRAND } from "@/lib/brand";
import {
  listStorefrontFacetsFn,
  listStorefrontProductsFn,
} from "@/lib/services/storefront.functions";

interface ShopSearch {
  q?: string | undefined;
  type?: string | undefined;
  sort?: string | undefined;
}

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
    type:
      typeof search["type"] === "string" && search["type"]
        ? search["type"].slice(0, 120)
        : undefined,
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

  const products = useQuery({
    queryKey: ["storefront-products", search.q ?? "", search.type ?? "", search.sort ?? "featured"],
    queryFn: () =>
      fetchProducts({
        data: {
          query: search.q,
          productType: search.type,
          sort: search.sort,
          limit: 48,
        },
      }),
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
          type: merged.type || undefined,
          sort: merged.sort && merged.sort !== "featured" ? merged.sort : undefined,
        };
      }) as never,
      replace: true,
    });
  };

  const items = products.data?.items ?? [];
  const types = facets.data?.product_types ?? [];
  const filtered = Boolean(search.q || search.type);

  return (
    <PublicShell>
      <div className="mx-auto w-full max-w-6xl px-5 pt-12 sm:px-8 sm:pt-16">
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
              className="h-11 w-full rounded-lg border border-input bg-background px-4 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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
                className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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
              className="inline-flex h-11 shrink-0 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Search
            </button>
          </div>
        </form>

        {types.length > 0 ? (
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSearch({ type: undefined })}
              aria-pressed={!search.type}
              className={`inline-flex min-h-9 items-center rounded-full border px-3.5 text-xs transition-colors ${
                search.type
                  ? "border-border text-muted-foreground hover:text-foreground"
                  : "border-gold text-foreground"
              }`}
            >
              All
            </button>
            {types.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setSearch({ type })}
                aria-pressed={search.type === type}
                className={`inline-flex min-h-9 items-center rounded-full border px-3.5 text-xs transition-colors ${
                  search.type === type
                    ? "border-gold text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mx-auto w-full max-w-6xl px-5 pb-8 pt-10 sm:px-8">
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
                  onClick={() => setSearch({ q: undefined, type: undefined })}
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
              {products.data?.total ?? items.length} product
              {(products.data?.total ?? items.length) === 1 ? "" : "s"}
            </p>
            <ul className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
              {items.map((product, index) => (
                <li key={product.id}>
                  <ProductCard product={product} eager={index < 4} />
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="mt-14 rounded-2xl border border-border/70 p-7 sm:p-9">
          <h2 className="font-display text-2xl text-foreground">Browse by collection</h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Collections group the range by how the products are used, which is often a faster way
            in than searching.
          </p>
          <Link
            to="/collections/"
            className="mt-5 inline-flex min-h-11 items-center rounded-lg border border-input px-5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            See collections
          </Link>
        </div>
      </div>
    </PublicShell>
  );
}
