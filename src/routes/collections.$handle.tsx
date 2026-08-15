import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { PublicShell } from "@/components/public/PublicShell";
import { Breadcrumbs } from "@/components/public/Breadcrumbs";
import { JsonLd } from "@/components/public/JsonLd";
import { ProductCard } from "@/components/public/ProductCard";
import { BRAND } from "@/lib/brand";
import {
  getStorefrontCollectionFn,
  listStorefrontProductsFn,
} from "@/lib/services/storefront.functions";

export const Route = createFileRoute("/collections/$handle")({
  loader: async ({ params }) => {
    const collection = await getStorefrontCollectionFn({ data: { handle: params.handle } });
    if (!collection) throw notFound();
    const products = await listStorefrontProductsFn({
      data: { collectionHandle: params.handle, limit: 48 },
    });
    return { collection, products: products.items };
  },
  head: ({ params, loaderData }) => {
    const url = `${BRAND.siteUrl}/collections/${params.handle}`;
    if (!loaderData) {
      return {
        meta: [{ title: `Unavailable | ${BRAND.name}` }, { name: "robots", content: "noindex" }],
      };
    }
    const { collection } = loaderData;
    const description = (
      collection.description ??
      `Browse the ${collection.title} collection from ${BRAND.name} and order on the main store.`
    ).slice(0, 155);
    return {
      meta: [
        { title: `${collection.title} | ${BRAND.name}` },
        { name: "description", content: description },
        { property: "og:title", content: `${collection.title} | ${BRAND.name}` },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:url", content: url },
        { name: "twitter:card", content: "summary_large_image" },
        ...(collection.image_url
          ? [
              { property: "og:image", content: collection.image_url },
              { name: "twitter:image", content: collection.image_url },
            ]
          : []),
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  notFoundComponent: CollectionNotFound,
  component: CollectionDetail,
});

function CollectionNotFound() {
  return (
    <PublicShell>
      <section className="mx-auto w-full max-w-3xl px-5 py-24 text-center sm:px-8">
        <h1 className="font-display text-3xl text-foreground">Collection not found</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          This collection is not listed here. You can browse the full range instead.
        </p>
        <Link
          to="/collections"
          className="mt-7 inline-flex min-h-11 items-center rounded-lg border border-input px-5 text-sm font-medium text-foreground hover:bg-accent"
        >
          All collections
        </Link>
      </section>
    </PublicShell>
  );
}

function CollectionDetail() {
  const { collection, products } = Route.useLoaderData();
  const url = `${BRAND.siteUrl}/collections/${collection.handle}`;

  return (
    <PublicShell>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: collection.title,
          url,
          ...(collection.description ? { description: collection.description } : {}),
          ...(products.length > 0
            ? {
                mainEntity: {
                  "@type": "ItemList",
                  numberOfItems: products.length,
                  itemListElement: products.map((product, index) => ({
                    "@type": "ListItem",
                    position: index + 1,
                    url: `${BRAND.siteUrl}/shop/${product.handle}`,
                    name: product.title,
                  })),
                },
              }
            : {}),
        }}
      />

      <section className="mx-auto w-full max-w-6xl px-5 pt-12 sm:px-8 sm:pt-16">
        <Breadcrumbs
          items={[
            { label: "Collections", href: "/collections" },
            { label: collection.title },
          ]}
        />
        <h1 className="mt-4 font-display text-4xl leading-tight text-foreground sm:text-5xl">
          {collection.title}
        </h1>
        {collection.description ? (
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
            {collection.description}
          </p>
        ) : null}

        {products.length === 0 ? (
          <div className="mt-10 rounded-xl border border-dashed border-border p-10 text-center">
            <h2 className="font-display text-xl text-foreground">
              Nothing is listed in this collection yet
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              Products appear here as soon as they are grouped into this collection on the store.
            </p>
            <Link
              to="/shop"
              className="mt-6 inline-flex min-h-11 items-center rounded-lg border border-input px-5 text-sm font-medium text-foreground hover:bg-accent"
            >
              Browse the full range
            </Link>
          </div>
        ) : (
          <ul className="mt-10 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {products.map((product, index) => (
              <li key={product.id}>
                <ProductCard product={product} eager={index < 4} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </PublicShell>
  );
}
