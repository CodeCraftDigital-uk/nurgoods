import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PublicShell } from "@/components/public/PublicShell";
import { JsonLd } from "@/components/public/JsonLd";
import { ReviewPlacementSlot } from "@/components/public/ReviewPlacementSlot";
import { ProductCard, ProductCardSkeleton } from "@/components/public/ProductCard";
import { BrandWordmark } from "@/components/admin/BrandLogo";
import { BRAND } from "@/lib/brand";
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
          "Considered everyday goods from NUR GOODS. Browse the range, read the Journal and see customer reviews, with ordering handled on the main store.",
      },
      { property: "og:title", content: "NUR GOODS | Good things, brought to light" },
      {
        property: "og:description",
        content:
          "Considered everyday goods, honest guidance and genuine customer reviews from NUR GOODS.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${BRAND.siteUrl}/` },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: `${BRAND.siteUrl}/` }],
  }),
  component: Index,
});

function Index() {
  const fetchProducts = useServerFn(listStorefrontProductsFn);
  const fetchCollections = useServerFn(listStorefrontCollectionsFn);
  const fetchArticles = useServerFn(listPublicArticles);

  const products = useQuery({
    queryKey: ["home-products"],
    queryFn: () => fetchProducts({ data: { limit: 4, sort: "featured" } }),
    retry: false,
  });
  const collections = useQuery({
    queryKey: ["home-collections"],
    queryFn: () => fetchCollections({}),
    retry: false,
  });
  const articles = useQuery({
    queryKey: ["public-articles"],
    queryFn: () => fetchArticles({}),
    retry: false,
  });

  const productItems = products.data?.items ?? [];
  const collectionItems = (collections.data ?? []).slice(0, 6);
  const articleItems = (articles.data ?? []).slice(0, 3);

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
      <section className="mx-auto w-full max-w-5xl px-5 pt-14 sm:px-8 sm:pt-24">
        <BrandWordmark height={56} className="sm:h-20" />
        <h1 className="mt-8 max-w-3xl font-display text-[2.1rem] leading-[1.08] text-foreground sm:text-6xl">
          {BRAND.tagline}
        </h1>
        <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          Considered everyday goods, clear guidance and reviews you can trust. Ordering, payment and
          delivery are handled on the main store.
        </p>
        <div className="mt-9 flex flex-wrap gap-3">
          <Link
            to="/shop"
            className="inline-flex min-h-11 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Browse the range
          </Link>
          <Link
            to="/journal"
            className="inline-flex min-h-11 items-center rounded-lg border border-input px-5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Read the Journal
          </Link>
        </div>
      </section>

      {/* Catalogue preview */}
      <section className="mx-auto mt-20 w-full max-w-5xl px-5 sm:px-8" aria-labelledby="range">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="range" className="font-display text-2xl text-foreground sm:text-3xl">
            From the range
          </h2>
          <Link
            to="/shop"
            className="inline-flex min-h-11 items-center text-sm font-medium text-foreground underline decoration-gold underline-offset-4"
          >
            See everything
          </Link>
        </div>

        <div className="mt-6">
          {products.isLoading ? (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <ProductCardSkeleton key={i} />
              ))}
            </div>
          ) : productItems.length > 0 ? (
            <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {productItems.map((product, index) => (
                <li key={product.id}>
                  <ProductCard product={product} eager={index < 2} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center sm:p-12">
              <h3 className="font-display text-xl text-foreground">The range is being prepared</h3>
              <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
                Products appear here as soon as the store catalogue is live. In the meantime the
                full range is available on the main store.
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

      {/* Collections */}
      {collectionItems.length > 0 ? (
        <section
          className="mx-auto mt-20 w-full max-w-5xl px-5 sm:px-8"
          aria-labelledby="collections"
        >
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 id="collections" className="font-display text-2xl text-foreground sm:text-3xl">
              Collections
            </h2>
            <Link
              to="/collections"
              className="inline-flex min-h-11 items-center text-sm font-medium text-foreground underline decoration-gold underline-offset-4"
            >
              All collections
            </Link>
          </div>
          <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {collectionItems.map((collection) => (
              <li key={collection.handle}>
                <Link
                  to="/collections/$handle"
                  params={{ handle: collection.handle }}
                  className="flex min-h-16 items-center justify-between rounded-xl border border-border/70 px-5 py-4 transition-colors hover:border-gold"
                >
                  <span className="font-display text-lg text-foreground">{collection.title}</span>
                  <span aria-hidden className="text-gold">
                    &rarr;
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Journal */}
      <section className="mx-auto mt-20 w-full max-w-5xl px-5 sm:px-8" aria-labelledby="journal">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 id="journal" className="font-display text-2xl text-foreground sm:text-3xl">
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
                  className="flex h-full flex-col rounded-xl border border-border/70 p-5 transition-colors hover:border-gold"
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

      <div className="mx-auto w-full max-w-5xl px-5 sm:px-8">
        <ReviewPlacementSlot surface="homepage" className="mt-20" />
      </div>

      {/* Support */}
      <section className="mx-auto mt-20 w-full max-w-5xl px-5 sm:px-8" aria-labelledby="support">
        <div className="rounded-2xl border border-border/70 p-8 sm:p-10">
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
