import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PublicShell } from "@/components/public/PublicShell";
import { Breadcrumbs } from "@/components/public/Breadcrumbs";
import { BRAND } from "@/lib/brand";
import { listStorefrontCollectionsFn } from "@/lib/services/storefront.functions";

export const Route = createFileRoute("/collections/")({
  head: () => ({
    meta: [
      { title: "Collections | NUR GOODS" },
      {
        name: "description",
        content:
          "Browse NUR GOODS collections. Each collection groups the range by how the products are used, so you can find the right thing faster.",
      },
      { property: "og:title", content: "Collections | NUR GOODS" },
      {
        property: "og:description",
        content: "Browse NUR GOODS collections and find the right everyday goods faster.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${BRAND.siteUrl}/collections` },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: `${BRAND.siteUrl}/collections` }],
  }),
  component: CollectionsIndex,
});

function CollectionsIndex() {
  const fetchCollections = useServerFn(listStorefrontCollectionsFn);
  const collections = useQuery({
    queryKey: ["storefront-collections"],
    queryFn: () => fetchCollections({}),
    retry: false,
  });

  const items = collections.data ?? [];

  return (
    <PublicShell>
      <section className="mx-auto w-full max-w-5xl px-5 pt-12 sm:px-8 sm:pt-16">
        <Breadcrumbs items={[{ label: "Collections", href: "/collections" }]} />
        <h1 className="mt-4 font-display text-4xl leading-tight text-foreground sm:text-5xl">
          Collections
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
          Collections group the {BRAND.name} range by how the products are actually used. They are
          listed from the live store, so they stay in step with what is available.
        </p>

        {collections.isLoading ? (
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <li key={index} className="h-40 animate-pulse rounded-xl bg-muted/50" />
            ))}
          </ul>
        ) : collections.isError ? (
          <div className="mt-10 rounded-xl border border-border/70 p-10 text-center">
            <h2 className="font-display text-xl text-foreground">Collections cannot be shown</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Please try again shortly, or browse everything on the store.
            </p>
          </div>
        ) : items.length === 0 ? (
          <div className="mt-10 rounded-xl border border-dashed border-border p-10 text-center">
            <h2 className="font-display text-xl text-foreground">Collections are on their way</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              Collections appear here as soon as the store range is grouped. Everything is already
              available to buy on the store.
            </p>
            <a
              href={BRAND.storeUrl}
              className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground"
            >
              Shop {BRAND.name}
            </a>
          </div>
        ) : (
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((collection) => (
              <li key={collection.id}>
                <Link
                  to="/collections/$handle"
                  params={{ handle: collection.handle }}
                  className="flex h-full flex-col overflow-hidden rounded-xl border border-border/70 transition-colors hover:border-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {collection.image_url ? (
                    <img
                      src={collection.image_url}
                      alt={collection.title}
                      width={800}
                      height={450}
                      loading="lazy"
                      decoding="async"
                      className="aspect-[16/9] w-full object-cover"
                    />
                  ) : null}
                  <div className="p-5">
                    <h2 className="font-display text-lg text-foreground">{collection.title}</h2>
                    {collection.description ? (
                      <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                        {collection.description}
                      </p>
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PublicShell>
  );
}
