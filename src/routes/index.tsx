import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PublicShell } from "@/components/public/PublicShell";
import { AiConnectorBanner } from "@/components/public/AiConnectorBanner";

import { JsonLd } from "@/components/public/JsonLd";
import { ReviewPlacementSlot } from "@/components/public/ReviewPlacementSlot";
import { ProductCard, ProductCardSkeleton } from "@/components/public/ProductCard";
import { CollectionTile, CollectionTileSkeleton } from "@/components/public/CollectionTile";
import { BRAND } from "@/lib/brand";
import { BRAND_ICONS, BRAND_SOCIAL_IMAGE } from "@/lib/brand-assets";

import { listPublicArticles } from "@/lib/services/public-content.functions";
import {
  listStorefrontCollectionsFn,
  listStorefrontProductsFn,
} from "@/lib/services/storefront.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NUR GOODS | Good things, brought to light" },
      {
        name: "description",
        content:
          "Browse the NUR GOODS range across home, fitness, tech, pets, beauty and more. Clear pricing, honest guidance and ordering handled on the main store.",
      },
      { property: "og:title", content: "NUR GOODS | Good things, brought to light" },
      {
        property: "og:description",
        content:
          "Everyday goods across home, fitness, tech, pets and beauty, with honest guidance from NUR GOODS.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${BRAND.siteUrl}/` },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: `${BRAND.siteUrl}/` }],
  }),
  // Server rendered so the home page ships real product, collection and
  // article links instead of an empty shell.
  loader: async () => {
    try {
      const [newest, browse, collections, articles] = await Promise.all([
        listStorefrontProductsFn({ data: { limit: 8, sort: "newest" } }),
        listStorefrontProductsFn({ data: { limit: 8, sort: "featured" } }),
        listStorefrontCollectionsFn({ data: { withProductsOnly: true } }),
        listPublicArticles({}),
      ]);
      return { newest, browse, collections, articles };
    } catch {
      return null;
    }
  },
  component: Index,
});


/** Service cues. Every line here is a statement of how the store actually works. */
const SERVICE_CUES = [
  {
    title: "Ordered on the main store",
    body: "Payment, delivery options and order tracking are handled by the NUR GOODS store checkout.",
  },
  {
    title: "One range, kept in step",
    body: "Everything listed here is read directly from the live store catalogue, so nothing is shown that is not stocked.",
  },
  {
    title: "A person answers",
    body: `Write to ${BRAND.supportEmail} with any question before or after ordering.`,
  },
] as const;

function Index() {
  const initial = Route.useLoaderData();
  const fetchProducts = useServerFn(listStorefrontProductsFn);
  const fetchCollections = useServerFn(listStorefrontCollectionsFn);
  const fetchArticles = useServerFn(listPublicArticles);

  const newest = useQuery({
    queryKey: ["home-newest"],
    queryFn: () => fetchProducts({ data: { limit: 8, sort: "newest" } }),
    ...(initial ? { initialData: initial.newest } : {}),
    retry: false,
  });
  const browse = useQuery({
    queryKey: ["home-browse"],
    queryFn: () => fetchProducts({ data: { limit: 8, sort: "featured" } }),
    ...(initial ? { initialData: initial.browse } : {}),
    retry: false,
  });
  const collections = useQuery({
    queryKey: ["home-collections"],
    queryFn: () => fetchCollections({ data: { withProductsOnly: true } }),
    ...(initial ? { initialData: initial.collections } : {}),
    retry: false,
  });
  const articles = useQuery({
    queryKey: ["public-articles"],
    queryFn: () => fetchArticles({}),
    ...(initial ? { initialData: initial.articles } : {}),
    retry: false,
  });


  const newestItems = newest.data?.items ?? [];
  const browseItems = browse.data?.items ?? [];
  const collectionItems = [...(collections.data ?? [])]
    .sort((a, b) => b.product_count - a.product_count || a.title.localeCompare(b.title))
    .slice(0, 8);
  const articleItems = (articles.data ?? []).slice(0, 3);
  const heroImages = newestItems
    .map((product) => product.image_url)
    .filter((url): url is string => Boolean(url))
    .slice(0, 3);
  const totalProducts = browse.data?.total ?? newest.data?.total ?? 0;

  return (
    <PublicShell>
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "Organization",
            name: BRAND.name,
            url: BRAND.siteUrl,
            slogan: BRAND.tagline,
            email: BRAND.supportEmail,
            logo: {
              "@type": "ImageObject",
              url: `${BRAND.siteUrl}${BRAND_ICONS.icon512}`,
              width: 512,
              height: 512,
            },
            image: `${BRAND.siteUrl}${BRAND_SOCIAL_IMAGE.path}`,
            sameAs: [BRAND.tiktokUrl],

            contactPoint: [
              {
                "@type": "ContactPoint",
                contactType: "customer support",
                email: BRAND.supportEmail,
                availableLanguage: "English",
              },
            ],
          },
          {
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: BRAND.name,
            url: BRAND.siteUrl,
            publisher: { "@type": "Organization", name: BRAND.name },
          },
        ]}
      />

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border/70">
        <div aria-hidden className="brand-gradient absolute inset-0" />
        {/* Cool highlight. Warm light over navy reads olive, so the glow stays
            in the brand blue family and gold is reserved for solid accents. */}
        <div
          aria-hidden
          className="absolute -right-24 top-[-10rem] size-[28rem] rounded-full bg-brand/35 blur-3xl"
        />
        <div className="relative">
          <AiConnectorBanner />
        </div>
        <div className="relative mx-auto grid w-full max-w-7xl items-center gap-10 px-5 pb-14 pt-8 sm:px-8 sm:pb-20 sm:pt-10 lg:grid-cols-[1.05fr_1fr] lg:gap-14">

          <div className="min-w-0">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-navy-foreground backdrop-blur">
              <span aria-hidden className="size-1.5 rounded-full bg-gold" />
              {BRAND.name} marketplace
            </span>
            <h1 className="mt-5 max-w-2xl font-brand text-[2.6rem] font-semibold leading-[1.02] text-navy-foreground sm:text-5xl lg:text-6xl">
              {BRAND.tagline}
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-navy-foreground/80 sm:text-lg">
              Everyday goods across home, fitness, tech, pets, beauty and play. Browse the full
              range here, then order securely on the {BRAND.name} store.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                to="/store"
                className="inline-flex min-h-12 items-center rounded-2xl bg-gold px-6 text-sm font-semibold text-gold-foreground transition-transform hover:-translate-y-0.5"
              >
                Browse the range
              </Link>
              <Link
                to="/collections"
                className="inline-flex min-h-12 items-center rounded-2xl border border-white/30 bg-white/10 px-6 text-sm font-semibold text-navy-foreground backdrop-blur transition-colors hover:bg-white/20"
              >
                Shop by category
              </Link>
            </div>
            {totalProducts > 0 ? (
              <p className="mt-6 text-xs font-medium uppercase tracking-[0.2em] text-navy-foreground/70">
                {totalProducts} products listed from the live store
              </p>
            ) : null}
          </div>

          <div className="glass-panel rounded-3xl p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-display text-sm font-semibold uppercase tracking-[0.14em] text-foreground">
                Recently added
              </h2>
              <Link
                to="/store"
                search={{ sort: "newest" }}
                className="text-xs font-semibold text-brand hover:underline"
              >
                See all
              </Link>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              {heroImages.length > 0
                ? newestItems.slice(0, 4).map((product, index) => (
                    <Link
                      key={product.id}
                      to="/shop/$handle"
                      params={{ handle: product.handle }}
                      className="group overflow-hidden rounded-2xl border border-border/70 bg-surface"
                    >
                      <div className="aspect-square w-full overflow-hidden bg-surface-muted">
                        {product.image_url ? (
                          <img
                            src={product.image_url}
                            alt={product.title}
                            width={400}
                            height={400}
                            loading={index < 2 ? "eager" : "lazy"}
                            decoding="async"
                            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                          />
                        ) : null}
                      </div>
                      <p className="truncate px-3 py-2 text-[0.72rem] font-medium text-foreground">
                        {product.title}
                      </p>
                    </Link>
                  ))
                : [0, 1, 2, 3].map((index) => (
                    <div
                      key={index}
                      className="aspect-square animate-pulse rounded-2xl bg-surface-muted"
                    />
                  ))}
            </div>
          </div>
        </div>
      </section>


      {/* Categories */}
      <section className="mx-auto mt-16 w-full max-w-7xl px-5 sm:mt-24 sm:px-8" aria-labelledby="categories">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="categories" className="font-brand text-[1.7rem] text-foreground sm:text-[2rem]">
              Shop by category
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
              Categories come straight from the store, so each one only appears when there is
              something in it.
            </p>
          </div>
          <Link
            to="/collections"
            className="inline-flex min-h-11 items-center text-sm font-medium text-foreground underline decoration-gold underline-offset-4"
          >
            All categories
          </Link>
        </div>
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {collections.isLoading
            ? [0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
                <li key={index}>
                  <CollectionTileSkeleton />
                </li>
              ))
            : collectionItems.map((collection) => (
                <li key={collection.id}>
                  <CollectionTile collection={collection} />
                </li>
              ))}
        </ul>
      </section>

      {/* New in */}
      <section className="mx-auto mt-16 w-full max-w-7xl px-5 sm:mt-24 sm:px-8" aria-labelledby="new-in">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="new-in" className="font-brand text-[1.7rem] text-foreground sm:text-[2rem]">
              Recently added
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
              The most recently updated listings in the store range.
            </p>
          </div>
          <Link
            to="/store"
            search={{ sort: "newest" }}
            className="inline-flex min-h-11 items-center text-sm font-medium text-foreground underline decoration-gold underline-offset-4"
          >
            See more
          </Link>
        </div>
        <div className="mt-6">
          {newest.isLoading ? (
            <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {[0, 1, 2, 3].map((index) => (
                <li key={index}>
                  <ProductCardSkeleton />
                </li>
              ))}
            </ul>
          ) : newestItems.length > 0 ? (
            <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {newestItems.slice(0, 8).map((product, index) => (
                <li key={product.id}>
                  <ProductCard product={product} eager={index < 2} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center sm:p-12">
              <h3 className="font-display text-xl text-foreground">The range is being prepared</h3>
              <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
                Products appear here as soon as the store catalogue is listed. Everything is already
                available to buy on the store.
              </p>
              <a
                href={BRAND.storeUrl}
                className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Visit the store
              </a>
            </div>
          )}
        </div>
      </section>

      {/* A to Z of the range */}
      {browseItems.length > 0 ? (
        <section
          className="mx-auto mt-16 w-full max-w-7xl px-5 sm:mt-24 sm:px-8"
          aria-labelledby="from-the-range"
        >
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="from-the-range" className="font-brand text-[1.7rem] text-foreground sm:text-[2rem]">
              From the range
            </h2>
            <Link
              to="/store"
              className="inline-flex min-h-11 items-center text-sm font-medium text-foreground underline decoration-gold underline-offset-4"
            >
              See everything
            </Link>
          </div>
          <ul className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {browseItems.slice(0, 4).map((product) => (
              <li key={product.id}>
                <ProductCard product={product} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Service cues */}
      <section className="mx-auto mt-16 w-full max-w-7xl px-5 sm:mt-24 sm:px-8" aria-labelledby="service">
        <h2 id="service" className="sr-only">
          How ordering works
        </h2>
        <ul className="grid gap-3 sm:grid-cols-3 sm:gap-4">
          {SERVICE_CUES.map((cue) => (
            <li key={cue.title} className="glass-card rounded-2xl p-6">
              <h3 className="font-display text-lg text-foreground">{cue.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{cue.body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* Journal */}
      <section className="mx-auto mt-16 w-full max-w-7xl px-5 sm:mt-24 sm:px-8" aria-labelledby="journal">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="journal" className="font-brand text-[1.7rem] text-foreground sm:text-[2rem]">
            From the Journal
          </h2>
          <Link
            to="/journal"
            className="inline-flex min-h-11 items-center text-sm font-medium text-foreground underline decoration-gold underline-offset-4"
          >
            All articles
          </Link>
        </div>
        {articleItems.length > 0 ? (
          <ul className="mt-6 grid gap-5 sm:grid-cols-3">
            {articleItems.map((article) => (
              <li key={article.id}>
                <Link
                  to="/journal/$slug"
                  params={{ slug: article.slug }}
                  className="flex h-full flex-col glass-card rounded-2xl p-5 transition-all hover:-translate-y-0.5"
                >
                  <h3 className="font-display text-lg leading-snug text-foreground">
                    {article.title}
                  </h3>
                  {article.excerpt ? (
                    <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                      {article.excerpt}
                    </p>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-5 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Guides, comparisons and care notes are being written now. Every piece lists its sources
            and is approved by a person before it appears.
          </p>
        )}
      </section>

      <div className="mx-auto w-full max-w-7xl px-5 sm:px-8">
        <ReviewPlacementSlot surface="homepage" className="mt-16 sm:mt-24" />
      </div>

      {/* Support */}
      <section className="mx-auto mt-16 w-full max-w-7xl px-5 sm:mt-24 sm:px-8" aria-labelledby="support">
        <div className="glass-card rounded-3xl p-8 sm:p-10">
          <h2 id="support" className="font-display text-2xl text-foreground">
            Questions before you order?
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Delivery, returns and privacy are set out in full in the policy pages. If anything is
            unclear, write to us and a person will reply.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/legal"
              className="inline-flex min-h-11 items-center rounded-lg border border-input px-5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              Policies and trust
            </Link>
            <Link
              to="/reviews"
              className="inline-flex min-h-11 items-center rounded-lg border border-input px-5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              Customer reviews
            </Link>
            <a
              href={`mailto:${BRAND.supportEmail}`}
              className="inline-flex min-h-11 items-center rounded-lg border border-input px-5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              {BRAND.supportEmail}
            </a>
          </div>
        </div>
      </section>
    </PublicShell>
  );
}
