import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { PublicShell } from "@/components/public/PublicShell";
import { Breadcrumbs } from "@/components/public/Breadcrumbs";
import { ProductCard } from "@/components/public/ProductCard";
import { JsonLd } from "@/components/public/JsonLd";
import { BRAND } from "@/lib/brand";
import { getStorefrontCategoryFn } from "@/lib/services/storefront.functions";

const PAGE_SIZE = 48;

export const Route = createFileRoute("/category/$slug")({
  // Fully server rendered: category pages exist so crawlers and answer engines
  // can reach the catalogue through stable, topical URLs.
  loader: async ({ params }) => {
    const category = await getStorefrontCategoryFn({
      data: { slug: params.slug, limit: PAGE_SIZE, offset: 0 },
    });
    if (!category) throw notFound();
    return category;
  },
  head: ({ loaderData, params }) => {
    if (!loaderData) {
      return {
        meta: [
          { title: `Category not found | ${BRAND.name}` },
          { name: "robots", content: "noindex" },
        ],
      };
    }
    const url = `${BRAND.siteUrl}/category/${params.slug}`;
    const title = `${loaderData.name} | ${BRAND.name}`;
    const description =
      loaderData.description?.trim() ||
      `Shop ${loaderData.name.toLowerCase()} at ${BRAND.name}. ${loaderData.total} product${loaderData.total === 1 ? "" : "s"} curated from vetted suppliers, with free shipping in the UK and USA.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:url", content: url },
        { name: "twitter:card", content: "summary_large_image" },
        ...(loaderData.items[0]?.image_url
          ? [
              { property: "og:image", content: loaderData.items[0].image_url },
              { name: "twitter:image", content: loaderData.items[0].image_url },
            ]
          : []),
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  notFoundComponent: CategoryNotFound,
  component: CategoryPage,
});

function CategoryNotFound() {
  return (
    <PublicShell>
      <section className="mx-auto w-full max-w-3xl px-5 py-24 text-center sm:px-8">
        <h1 className="font-brand text-3xl text-foreground">Category not found</h1>
        <p className="mt-3 text-muted-foreground">
          This category is not part of the current range.
        </p>
        <Link
          to="/store"
          className="mt-6 inline-flex rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground"
        >
          Browse the store
        </Link>
      </section>
    </PublicShell>
  );
}

function CategoryPage() {
  const category = Route.useLoaderData();
  const url = `${BRAND.siteUrl}/category/${category.slug}`;

  return (
    <PublicShell>
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: category.name,
            url,
            isPartOf: { "@type": "WebSite", name: BRAND.name, url: BRAND.siteUrl },
            numberOfItems: category.total,
          },
          {
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: category.name,
            itemListElement: category.items.slice(0, 50).map((product, index) => ({
              "@type": "ListItem",
              position: index + 1,
              url: `${BRAND.siteUrl}/shop/${product.handle}`,
              name: product.title,
            })),
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Home", item: `${BRAND.siteUrl}/` },
              { "@type": "ListItem", position: 2, name: "Store", item: `${BRAND.siteUrl}/store` },
              ...(category.parent
                ? [
                    {
                      "@type": "ListItem",
                      position: 3,
                      name: category.parent.name,
                      item: `${BRAND.siteUrl}/category/${category.parent.slug}`,
                    },
                  ]
                : []),
              {
                "@type": "ListItem",
                position: category.parent ? 4 : 3,
                name: category.name,
                item: url,
              },
            ],
          },
        ]}
      />

      <section className="mx-auto w-full max-w-6xl px-5 pt-12 sm:px-8 sm:pt-16">
        <Breadcrumbs
          items={[
            { label: "Store", href: "/store" },
            ...(category.parent
              ? [{ label: category.parent.name, href: `/category/${category.parent.slug}` }]
              : []),
            { label: category.name, href: `/category/${category.slug}` },
          ]}
        />
        <h1 className="mt-4 font-brand text-4xl leading-tight text-foreground sm:text-5xl">
          {category.name}
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          {category.description?.trim() ||
            `${category.total} product${category.total === 1 ? "" : "s"} in ${category.name.toLowerCase()}, curated by NUR GOODS from vetted suppliers.`}
        </p>

        {category.children.length > 0 ? (
          <nav aria-label="Subcategories" className="mt-6 flex flex-wrap gap-2">
            {category.children.map((child) => (
              <Link
                key={child.slug}
                to="/category/$slug"
                params={{ slug: child.slug }}
                className="rounded-full border border-border bg-card/60 px-4 py-2 text-sm text-foreground transition hover:border-primary/40"
              >
                {child.name}
                <span className="ml-2 text-muted-foreground">{child.products}</span>
              </Link>
            ))}
          </nav>
        ) : null}
      </section>

      <section className="mx-auto w-full max-w-6xl px-5 pb-24 pt-8 sm:px-8">
        {category.items.length === 0 ? (
          <p className="rounded-2xl border border-border bg-card/60 p-8 text-center text-muted-foreground">
            Nothing is listed in this category right now.
          </p>
        ) : (
          <>
            <ul className="grid grid-cols-2 gap-4 sm:gap-5 lg:grid-cols-4">
              {category.items.map((product, index) => (
                <li key={product.id}>
                  <ProductCard product={product} eager={index < 4} />
                </li>
              ))}
            </ul>
            {category.total > category.items.length ? (
              <div className="mt-10 text-center">
                <Link
                  to="/store"
                  search={{ category: category.slug }}
                  className="inline-flex rounded-xl border border-border px-5 py-3 text-sm font-medium text-foreground transition hover:border-primary/40"
                >
                  See all {category.total} in {category.name}
                </Link>
              </div>
            ) : null}
          </>
        )}
      </section>
    </PublicShell>
  );
}
