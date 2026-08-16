import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { PublicShell } from "@/components/public/PublicShell";
import { Breadcrumbs } from "@/components/public/Breadcrumbs";
import { ProductCard, ProductCardSkeleton } from "@/components/public/ProductCard";
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
  head: () => ({
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
    ],
    links: [{ rel: "canonical", href: `${BRAND.siteUrl}/store` }],
  }),
  component: StoreIndex,
});

function StoreIndex() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/store/" });
  const [term, setTerm] = useState(search.q ?? "");
  const [expanded, setExpanded] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [loaded, setLoaded] = useState<StoreCard[]>([]);
  const suggestBox = useRef<HTMLDivElement | null>(null);

  const runSearch = useServerFn(searchCatalogueFn);
  const runSuggest = useServerFn(suggestCatalogueFn);

  useEffect(() => {
    setTerm(search.q ?? "");
  }, [search.q]);

  // Any change of search or filter restarts the range from the first page.
  useEffect(() => {
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
  const tags = facets?.tags ?? [];
  const collections = facets?.collections ?? [];
  const currency = facets?.price.currency ?? "GBP";
  const filtered = Boolean(
    search.q || search.category || search.collection || search.tag || search.max || search.instock,
  );

  const priceSteps = useMemo(() => {
    const max = facets?.price.max ?? 0;
    if (!max) return [] as number[];
    return [10, 20, 30, 50, 100].filter((step) => step < max);
  }, [facets?.price.max]);

  const formatPrice = (value: number) =>
    new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(value);

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
      <div className="mx-auto w-full max-w-7xl px-5 pt-12 sm:px-8 sm:pt-16">
        <Breadcrumbs items={[{ label: "Store", href: "/store" }]} />
        <h1 className="mt-4 font-display text-4xl leading-tight text-foreground sm:text-5xl">
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
                {categories.slice(0, expanded ? categories.length : 18).map((category) => (
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
            </div>
          ) : null}

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <h2 className="mr-1 text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">
              Price and stock
            </h2>
            {priceSteps.map((step) => (
              <button
                key={step}
                type="button"
                onClick={() => setSearch({ max: search.max === step ? undefined : step })}
                aria-pressed={search.max === step}
                className={chip(search.max === step)}
              >
                Under {formatPrice(step)}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSearch({ instock: search.instock ? undefined : true })}
              aria-pressed={Boolean(search.instock)}
              className={chip(Boolean(search.instock))}
            >
              In stock
              {facets ? <span className="text-[0.65rem] opacity-70">{facets.available}</span> : null}
            </button>
          </div>

          {collections.length > 0 ? (
            <div className="mt-6">
              <h2 className="text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">
                Collections
              </h2>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setSearch({ collection: undefined })}
                  aria-pressed={!search.collection}
                  className={chip(!search.collection)}
                >
                  All
                </button>
                {collections.slice(0, expanded ? collections.length : 12).map((collection) => (
                  <button
                    key={collection.handle}
                    type="button"
                    onClick={() =>
                      setSearch({
                        collection:
                          search.collection === collection.handle ? undefined : collection.handle,
                      })
                    }
                    aria-pressed={search.collection === collection.handle}
                    className={chip(search.collection === collection.handle)}
                  >
                    {collection.title}
                    <span className="text-[0.65rem] opacity-70">{collection.products}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {tags.length > 0 ? (
            <div className="mt-6">
              <h2 className="text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">
                Popular tags
              </h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {tags.slice(0, expanded ? tags.length : 12).map((tag) => (
                  <button
                    key={tag.tag}
                    type="button"
                    onClick={() => setSearch({ tag: search.tag === tag.tag ? undefined : tag.tag })}
                    aria-pressed={search.tag === tag.tag}
                    className={chip(search.tag === tag.tag)}
                  >
                    {tag.tag}
                    <span className="text-[0.65rem] opacity-70">{tag.products}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-3">
            {categories.length > 18 || collections.length > 12 || tags.length > 12 ? (
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                aria-expanded={expanded}
                className="inline-flex min-h-10 items-center rounded-xl border border-input bg-surface px-4 text-xs font-semibold text-foreground transition-colors hover:border-brand/50"
              >
                {expanded ? "Show fewer filters" : "Show all filters"}
              </button>
            ) : null}
            {filtered ? (
              <button
                type="button"
                onClick={clearAll}
                className="inline-flex min-h-10 items-center rounded-xl border border-input bg-surface px-4 text-xs font-semibold text-foreground transition-colors hover:border-brand/50"
              >
                Reset everything
              </button>
            ) : null}
          </div>
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

        <div className="glass-card mt-14 rounded-3xl p-7 sm:p-9">
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
