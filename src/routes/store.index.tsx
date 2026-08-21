import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { PublicShell } from "@/components/public/PublicShell";
import { Breadcrumbs } from "@/components/public/Breadcrumbs";
import { ProductCard, ProductCardSkeleton } from "@/components/public/ProductCard";
import { JsonLd } from "@/components/public/JsonLd";

import { BRAND } from "@/lib/brand";
import {
  searchCatalogueFn,
  suggestCatalogueFn,
} from "@/lib/services/catalogue-search.functions";

interface StoreSearch {
  q?: string | undefined;
  /** Canonical NUR GOODS category slug. */
  category?: string | undefined;
  collection?: string | undefined;
  tag?: string | undefined;
  sort?: string | undefined;
  max?: number | undefined;
  instock?: boolean | undefined;
}

type StoreCard = Awaited<ReturnType<typeof searchCatalogueFn>>["items"][number];

const SORT_OPTIONS = [
  { value: "relevance", label: "Most relevant" },
  { value: "featured", label: "Featured" },
  { value: "price_asc", label: "Price, low to high" },
  { value: "price_desc", label: "Price, high to low" },
  { value: "newest", label: "Recently added" },
  { value: "title_desc", label: "Name, Z to A" },
] as const;

const PAGE_SIZE = 48;

export const Route = createFileRoute("/store/")({
  validateSearch: (search: Record<string, unknown>): StoreSearch => {
    const str = (key: string) =>
      typeof search[key] === "string" && search[key] ? String(search[key]).slice(0, 255) : undefined;
    const max = Number(search["max"]);
    return {
      q: str("q"),
      category: str("category"),
      collection: str("collection"),
      tag: str("tag"),
      sort: str("sort"),
      max: Number.isFinite(max) && max > 0 ? max : undefined,
      instock: search["instock"] === true || search["instock"] === "true" ? true : undefined,
    };
  },
  loaderDeps: ({ search }) => ({ ...search }),
  // The first page is rendered on the server so crawlers and answer engines
  // see real product links instead of an empty shell.
  loader: async ({ deps }) => {
    // Client navigations must commit instantly: the page refetches through
    // React Query instead of blocking the route transition on the server.
    if (typeof window !== "undefined") return null;
    try {
      const page = await searchCatalogueFn({
        data: {
          query: deps.q,
          category: deps.category,
          collectionHandle: deps.collection,
          tag: deps.tag,
          priceMax: deps.max,
          availableOnly: deps.instock,
          sort: deps.sort,
          limit: PAGE_SIZE,
          offset: 0,
        },
      });
      return {
        page,
        refined: Boolean(deps.q || deps.sort || deps.max || deps.instock),
      };
    } catch {
      return null;
    }
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: "Store | Browse the full NUR GOODS range" },
      {
        name: "description",
        content:
          "Search and browse every NUR GOODS product in one place. Filter by category, price and availability, then order through secure store checkout.",
      },
      { property: "og:title", content: "Store | Browse the full NUR GOODS range" },
      {
        property: "og:description",
        content: "Search, filter and compare the full NUR GOODS range of considered everyday goods.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${BRAND.siteUrl}/store` },
      { name: "twitter:card", content: "summary_large_image" },
      // Refined result sets are near duplicates of the main listing, so they
      // stay crawlable for discovery but out of the index.
      ...(loaderData?.refined ? [{ name: "robots", content: "noindex, follow" }] : []),
    ],
    links: [{ rel: "canonical", href: `${BRAND.siteUrl}/store` }],
  }),
  component: StoreIndex,
});

function StoreIndex() {
  const search = Route.useSearch();
  const loaderData = Route.useLoaderData();
  const initialPage = loaderData?.page ?? null;
  const navigate = useNavigate({ from: "/store/" });
  const [term, setTerm] = useState(search.q ?? "");
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [loaded, setLoaded] = useState<StoreCard[]>(initialPage?.items ?? []);
  const suggestBox = useRef<HTMLDivElement | null>(null);


  const runSearch = useServerFn(searchCatalogueFn);
  const runSuggest = useServerFn(suggestCatalogueFn);

  useEffect(() => {
    setTerm(search.q ?? "");
  }, [search.q]);

  // Any change of search or filter restarts the range from the first page. The
  // first pass is skipped so the server rendered page is not thrown away.
  const firstPass = useRef(true);
  useEffect(() => {
    if (firstPass.current) {
      firstPass.current = false;
      return;
    }
    setOffset(0);
    setLoaded([]);
  }, [
    search.q,
    search.category,
    search.collection,
    search.tag,
    search.sort,
    search.max,
    search.instock,
  ]);

  const results = useQuery({
    queryKey: [
      "catalogue-search",
      search.q ?? "",
      search.category ?? "",
      search.collection ?? "",
      search.tag ?? "",
      search.sort ?? "",
      search.max ?? 0,
      search.instock ? 1 : 0,
      offset,
    ],
    queryFn: () =>
      runSearch({
        data: {
          query: search.q,
          category: search.category,
          collectionHandle: search.collection,
          tag: search.tag,
          priceMax: search.max,
          availableOnly: search.instock,
          sort: search.sort,
          limit: PAGE_SIZE,
          offset,
        },
      }),
    ...(offset === 0 && initialPage ? { initialData: initialPage } : {}),
    placeholderData: keepPreviousData,
    retry: false,
  });


  const pageItems = results.data?.items;
  useEffect(() => {
    if (!pageItems) return;
    setLoaded((previous) => {
      const seen = new Set(previous.map((item) => item.id));
      const additions = pageItems.filter((item) => !seen.has(item.id));
      return additions.length ? [...previous, ...additions] : previous;
    });
  }, [pageItems]);

  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(term.trim()), 180);
    return () => clearTimeout(id);
  }, [term]);

  const suggestions = useQuery({
    queryKey: ["catalogue-suggest", debounced],
    queryFn: () => runSuggest({ data: { query: debounced } }),
    enabled: debounced.length >= 2,
    staleTime: 60 * 1000,
    retry: false,
  });

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!suggestBox.current?.contains(event.target as Node)) setSuggestOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const setSearch = (next: Partial<StoreSearch>) => {
    void navigate({
      search: ((prev: StoreSearch) => {
        const merged = { ...prev, ...next };
        return {
          q: merged.q || undefined,
          category: merged.category || undefined,
          collection: merged.collection || undefined,
          tag: merged.tag || undefined,
          sort: merged.sort || undefined,
          max: merged.max || undefined,
          instock: merged.instock || undefined,
        };
      }) as never,
      replace: true,
    });
  };

  const items = loaded;
  const total = results.data?.total ?? items.length;
  const hasMore = items.length > 0 && items.length < total;
  const facets = results.data?.facets;
  const categories = facets?.categories ?? [];
  const filtered = Boolean(
    search.q || search.category || search.collection || search.tag || search.max || search.instock,
  );



  const clearAll = () =>
    setSearch({
      q: undefined,
      category: undefined,
      collection: undefined,
      tag: undefined,
      max: undefined,
      instock: undefined,
    });

  const chip = (active: boolean) =>
    `inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-xs transition-colors ${
      active
        ? "border-transparent bg-primary text-primary-foreground shadow-sm"
        : "border-border bg-surface text-muted-foreground hover:border-brand/40 hover:text-foreground"
    }`;

  return (
    <PublicShell>
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: `The ${BRAND.name} store`,
            url: `${BRAND.siteUrl}/store`,
            isPartOf: { "@type": "WebSite", name: BRAND.name, url: BRAND.siteUrl },
            ...(total ? { numberOfItems: total } : {}),
          },
          {
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: `${BRAND.name} products`,
            itemListElement: items.slice(0, 48).map((item, index) => ({
              "@type": "ListItem",
              position: index + 1,
              url: `${BRAND.siteUrl}/shop/${item.handle}`,
              name: item.title,
            })),
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Home", item: `${BRAND.siteUrl}/` },
              { "@type": "ListItem", position: 2, name: "Store", item: `${BRAND.siteUrl}/store` },
            ],
          },
        ]}
      />
      <div className="mx-auto w-full max-w-7xl px-5 pt-12 sm:px-8 sm:pt-16">
        <Breadcrumbs items={[{ label: "Store", href: "/store" }]} />

        <h1 className="mt-4 font-brand text-4xl leading-tight text-foreground sm:text-5xl">
          The {BRAND.name} store
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
          Search the whole range in one place. Everything listed here is read from the live store
          catalogue, so what you see is what is genuinely available.
        </p>

        <div ref={suggestBox} className="relative mt-8">
          <form
            role="search"
            className="flex flex-col gap-3 sm:flex-row sm:items-center"
            onSubmit={(event) => {
              event.preventDefault();
              setSuggestOpen(false);
              setSearch({ q: term.trim() });
            }}
          >
            <div className="relative flex-1">
              <label htmlFor="store-search" className="sr-only">
                Search the catalogue
              </label>
              <Search
                className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <input
                id="store-search"
                type="search"
                value={term}
                autoComplete="off"
                role="combobox"
                aria-expanded={suggestOpen}
                aria-controls="store-suggestions"
                onChange={(event) => {
                  setTerm(event.target.value);
                  setSuggestOpen(true);
                }}
                onFocus={() => setSuggestOpen(true)}
                placeholder="Search products, categories and tags"
                className="h-14 w-full rounded-2xl border border-input bg-surface pl-11 pr-11 text-base shadow-[var(--shadow-card)] focus:border-brand focus:ring-4 focus:ring-brand/15 text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
              {term ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => {
                    setTerm("");
                    setSearch({ q: undefined });
                  }}
                  className="absolute right-3 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <X className="size-4" aria-hidden />
                </button>
              ) : null}
            </div>
            <div className="flex gap-3">
              <div className="flex-1 sm:flex-none">
                <label htmlFor="store-sort" className="sr-only">
                  Sort products
                </label>
                <select
                  id="store-sort"
                  value={search.sort ?? (search.q ? "relevance" : "featured")}
                  onChange={(event) => setSearch({ sort: event.target.value })}
                  className="h-14 w-full rounded-2xl border border-input bg-surface px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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
                className="inline-flex h-14 shrink-0 items-center rounded-2xl bg-primary px-7 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Search
              </button>
            </div>
          </form>

          {suggestOpen && debounced.length >= 2 && (suggestions.data ?? []).length > 0 ? (
            <ul
              id="store-suggestions"
              className="glass-card absolute z-30 mt-2 w-full max-w-3xl overflow-hidden rounded-2xl p-1.5"
            >
              {(suggestions.data ?? []).slice(0, 10).map((suggestion) => (
                <li key={`${suggestion.type}-${suggestion.value}`}>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setSuggestOpen(false);
                      if (suggestion.type === "product") {
                        void navigate({
                          to: "/shop/$handle",
                          params: { handle: suggestion.value },
                        });
                        return;
                      }
                      if (suggestion.type === "category") {
                        setTerm("");
                        setSearch({ q: undefined, category: suggestion.value });
                        return;
                      }
                      setTerm("");
                      setSearch({ q: undefined, tag: suggestion.value });
                    }}
                    className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:bg-accent"
                  >
                    <span className="truncate">{suggestion.label}</span>
                    <span className="shrink-0 text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
                      {suggestion.type}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="glass-card mt-6 rounded-3xl p-4 sm:p-6">
          {categories.length > 0 ? (
            <div>
              <h2 className="text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">
                Departments
              </h2>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSearch({ category: undefined })}
                  aria-pressed={!search.category}
                  className={chip(!search.category)}
                >
                  All
                </button>
                {categories.map((category) => (
                  <button
                    key={category.slug}
                    type="button"
                    onClick={() =>
                      setSearch({
                        category: search.category === category.slug ? undefined : category.slug,
                      })
                    }
                    aria-pressed={search.category === category.slug}
                    className={chip(search.category === category.slug)}
                  >
                    {category.name}
                    <span className="text-[0.65rem] opacity-70">{category.products}</span>
                  </button>
                ))}
              </div>
              {/* Real links so every department is reachable by crawlers and
                  answer engines, not only by the filter buttons above. */}
              <nav aria-label="Shop by department" className="mt-3 text-xs text-muted-foreground">
                <span className="mr-1">Browse department pages:</span>
                {categories.slice(0, 24).map((category, index) => (
                  <span key={`link-${category.slug}`}>
                    {index > 0 ? <span aria-hidden="true">, </span> : null}
                    <Link
                      to="/category/$slug"
                      params={{ slug: category.slug }}
                      className="underline-offset-2 transition-colors hover:text-foreground hover:underline"
                    >
                      {category.name}
                    </Link>
                  </span>
                ))}
              </nav>
            </div>
          ) : null}


          {filtered ? (
            <div className="mt-5">
              <button
                type="button"
                onClick={clearAll}
                className="inline-flex min-h-10 items-center rounded-xl border border-input bg-surface px-4 text-xs font-semibold text-foreground transition-colors hover:border-brand/50"
              >
                Reset search
              </button>
            </div>
          ) : null}

        </div>
      </div>

      <div className="mx-auto w-full max-w-7xl px-5 pb-8 pt-10 sm:px-8">
        {results.isLoading ? (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
              <li key={index}>
                <ProductCardSkeleton />
              </li>
            ))}
          </ul>
        ) : results.isError ? (
          <div className="rounded-xl border border-border/70 p-10 text-center">
            <h2 className="font-display text-xl text-foreground">Products cannot be shown</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              The range could not be loaded right now. Please try again in a moment.
            </p>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <h2 className="font-display text-xl text-foreground">
              {filtered ? "Nothing matched that search" : "The range is being prepared"}
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              {filtered
                ? "Try a shorter search, a different department, or reset the filters to see everything."
                : "Products appear here as soon as the store range is listed."}
            </p>
            {filtered ? (
              <button
                type="button"
                onClick={clearAll}
                className="mt-6 inline-flex min-h-11 items-center rounded-lg border border-input px-5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
              >
                Reset everything
              </button>
            ) : null}
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              Showing {items.length} of {total} product{total === 1 ? "" : "s"}
              {results.data?.correctedQuery ? ` for "${results.data.correctedQuery}"` : ""}
            </p>
            <ul className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
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
                  disabled={results.isFetching}
                  className="inline-flex min-h-11 items-center rounded-lg border border-input px-6 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60"
                >
                  {results.isFetching ? "Loading" : "Load more products"}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </PublicShell>
  );
}
