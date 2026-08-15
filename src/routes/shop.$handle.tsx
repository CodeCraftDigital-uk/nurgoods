import { useMemo, useState } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { PublicShell } from "@/components/public/PublicShell";
import { Breadcrumbs } from "@/components/public/Breadcrumbs";
import { JsonLd } from "@/components/public/JsonLd";
import { Markdown } from "@/components/public/Markdown";
import { ProductCard, formatPrice } from "@/components/public/ProductCard";
import { MissingProductImage } from "@/components/public/MissingProductImage";
import { ReviewPlacementSlot } from "@/components/public/ReviewPlacementSlot";
import { BRAND } from "@/lib/brand";
import { getStorefrontProductFn } from "@/lib/services/storefront.functions";

export const Route = createFileRoute("/shop/$handle")({
  loader: async ({ params }) => {
    const product = await getStorefrontProductFn({ data: { handle: params.handle } });
    if (!product) throw notFound();
    return { product };
  },
  head: ({ params, loaderData }) => {
    const url = `${BRAND.siteUrl}/shop/${params.handle}`;
    if (!loaderData) {
      return {
        meta: [{ title: `Unavailable | ${BRAND.name}` }, { name: "robots", content: "noindex" }],
      };
    }
    const { product } = loaderData;
    const description =
      product.summary ??
      `${product.title} from ${BRAND.name}. See the full details and order on the ${BRAND.name} store.`;
    return {
      meta: [
        { title: `${product.title} | ${BRAND.name}` },
        { name: "description", content: description.slice(0, 155) },
        { property: "og:title", content: `${product.title} | ${BRAND.name}` },
        { property: "og:description", content: description.slice(0, 155) },
        { property: "og:type", content: "product" },
        { property: "og:url", content: url },
        { name: "twitter:card", content: "summary_large_image" },
        ...(product.image_url
          ? [
              { property: "og:image", content: product.image_url },
              { name: "twitter:image", content: product.image_url },
            ]
          : []),
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  notFoundComponent: ProductNotFound,
  component: ProductDetail,
});

function ProductNotFound() {
  return (
    <PublicShell>
      <section className="mx-auto w-full max-w-3xl px-5 py-24 text-center sm:px-8">
        <h1 className="font-display text-3xl text-foreground">Product not found</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          This product is not listed here. The full range is always available on the store.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link
            to="/shop"
            className="inline-flex min-h-11 items-center rounded-lg border border-input px-5 text-sm font-medium text-foreground hover:bg-accent"
          >
            Back to the range
          </Link>
          <a
            href={BRAND.storeUrl}
            className="inline-flex min-h-11 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground"
          >
            Shop {BRAND.name}
          </a>
        </div>
      </section>
    </PublicShell>
  );
}

function ProductDetail() {
  const { product } = Route.useLoaderData();
  const [activeIndex, setActiveIndex] = useState(0);
  const gallery = useMemo(() => {
    const items = [...product.media];
    if (items.length === 0 && product.image_url) {
      items.push({ url: product.image_url, alt: product.title, width: null, height: null });
    }
    return items;
  }, [product]);
  const activeImage = gallery[Math.min(activeIndex, Math.max(gallery.length - 1, 0))] ?? null;
  const storeHref = product.store_url ?? BRAND.storeUrl;
  const price = formatPrice(product.price_min, product.price_max, product.currency);
  const url = `${BRAND.siteUrl}/shop/${product.handle}`;

  const schema: Record<string, unknown>[] = [
    {
      "@context": "https://schema.org",
      "@type": "Product",
      name: product.title,
      url,
      ...(product.summary ? { description: product.summary } : {}),
      ...(product.image_url ? { image: product.image_url } : {}),
      ...(product.vendor ? { brand: { "@type": "Brand", name: product.vendor } } : {}),
      ...(product.product_type ? { category: product.product_type } : {}),
      ...(price && product.price_min != null
        ? {
            offers: {
              "@type": "Offer",
              price: product.price_min,
              priceCurrency: product.currency ?? "GBP",
              url,
            },
          }
        : {}),
    },
  ];
  if (product.faqs.length > 0) {
    schema.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: product.faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: { "@type": "Answer", text: faq.answer },
      })),
    });
  }

  return (
    <PublicShell>
      <JsonLd data={schema} />

      <article className="mx-auto w-full max-w-6xl px-5 pt-10 sm:px-8 sm:pt-14">
        <Breadcrumbs
          items={[{ label: "Shop", href: "/shop" }, { label: product.title }]}
        />

        <div className="mt-6 grid gap-10 lg:grid-cols-2 lg:gap-14">
          <div>
            <div className="overflow-hidden rounded-2xl border border-border/70 bg-muted/40">
              {activeImage ? (
                <img
                  src={activeImage.url}
                  alt={activeImage.alt ?? product.title}
                  width={activeImage.width ?? 1200}
                  height={activeImage.height ?? 1200}
                  decoding="async"
                  className="aspect-square w-full object-cover"
                />
              ) : (
                <div className="aspect-square w-full">
                  <MissingProductImage />
                </div>
              )}
            </div>
            {gallery.length > 1 ? (
              <ul className="mt-3 grid grid-cols-5 gap-2 sm:gap-3">
                {gallery.slice(0, 10).map((item, index) => (
                  <li key={item.url}>
                    <button
                      type="button"
                      onClick={() => setActiveIndex(index)}
                      aria-label={`Show image ${index + 1}`}
                      aria-current={index === activeIndex}
                      className={`block w-full overflow-hidden rounded-lg border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                        index === activeIndex ? "border-gold" : "border-border/70 hover:border-gold/60"
                      }`}
                    >
                      <img
                        src={item.url}
                        alt=""
                        width={160}
                        height={160}
                        loading="lazy"
                        decoding="async"
                        className="aspect-square w-full object-cover"
                      />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div>
            {product.product_type ? (
              <p className="text-[0.68rem] uppercase tracking-[0.22em] text-muted-foreground">
                {product.product_type}
              </p>
            ) : null}
            <h1 className="mt-2 font-display text-3xl leading-tight text-foreground sm:text-4xl">
              {product.title}
            </h1>
            {price ? (
              <p className="mt-4 flex items-baseline gap-3 text-xl text-foreground">
                <span>{price}</span>
                {product.compare_at_price_min != null &&
                product.price_min != null &&
                product.compare_at_price_min > product.price_min ? (
                  <span className="text-sm text-muted-foreground line-through">
                    {formatPrice(product.compare_at_price_min, null, product.currency)}
                  </span>
                ) : null}
              </p>
            ) : null}
            {product.summary ? (
              <p className="mt-5 text-base leading-relaxed text-muted-foreground">
                {product.summary}
              </p>
            ) : null}

            {product.variants.length > 1 ? (
              <div className="mt-7">
                <h2 className="text-[0.68rem] uppercase tracking-[0.22em] text-muted-foreground">
                  Options
                </h2>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {product.variants.map((variant) => (
                    <li key={variant.id}>
                      <span
                        className={`inline-flex min-h-10 items-center rounded-lg border px-3.5 text-sm ${
                          variant.available_for_sale === false
                            ? "border-border/60 text-muted-foreground line-through"
                            : "border-border text-foreground"
                        }`}
                      >
                        {variant.selected_options.length > 0
                          ? variant.selected_options.map((option) => option.value).join(" / ")
                          : variant.title}
                        {variant.price != null ? (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {formatPrice(variant.price, null, variant.currency)}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  Choose your option at checkout on the store.
                </p>
              </div>
            ) : null}

            <a
              href={storeHref}
              className="mt-7 inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 sm:w-auto"
            >
              View on the {BRAND.name} store
            </a>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Payment, delivery options and order tracking are handled on the store. Full terms are
              set out in the policy pages.
            </p>

            {product.collections.length > 0 ? (
              <div className="mt-8">
                <h2 className="text-[0.68rem] uppercase tracking-[0.2em] text-muted-foreground">
                  Collections
                </h2>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {product.collections.map((collection) => (
                    <li key={collection.handle}>
                      <Link
                        to="/collections/$handle"
                        params={{ handle: collection.handle }}
                        className="inline-flex min-h-9 items-center rounded-full border border-border px-3.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        {collection.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>

        {product.description_html ? (
          <section className="mt-16 max-w-3xl">
            <h2 className="font-display text-2xl text-foreground">Description</h2>
            <div
              className="prose prose-sm mt-4 max-w-none text-muted-foreground prose-headings:font-display prose-headings:text-foreground prose-strong:text-foreground prose-a:text-foreground"
              dangerouslySetInnerHTML={{ __html: product.description_html }}
            />
          </section>
        ) : null}

        {product.long_description ? (
          <section className="mt-16 max-w-3xl">
            <h2 className="font-display text-2xl text-foreground">About this product</h2>
            <div className="mt-4">
              <Markdown source={product.long_description} />
            </div>
          </section>
        ) : null}

        {product.benefits.length > 0 || product.use_cases.length > 0 ? (
          <section className="mt-14 grid gap-10 sm:grid-cols-2">
            {product.benefits.length > 0 ? (
              <div>
                <h2 className="font-display text-xl text-foreground">Why people choose it</h2>
                <ul className="mt-3 space-y-2 text-sm leading-relaxed text-muted-foreground">
                  {product.benefits.map((benefit) => (
                    <li key={benefit} className="border-l-2 border-gold pl-3">
                      {benefit}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {product.use_cases.length > 0 ? (
              <div>
                <h2 className="font-display text-xl text-foreground">Where it works well</h2>
                <ul className="mt-3 space-y-2 text-sm leading-relaxed text-muted-foreground">
                  {product.use_cases.map((useCase) => (
                    <li key={useCase} className="border-l-2 border-gold pl-3">
                      {useCase}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}

        {product.specifications.length > 0 ? (
          <section className="mt-14 max-w-3xl">
            <h2 className="font-display text-xl text-foreground">Specifications</h2>
            <dl className="mt-4 divide-y divide-border/70 border-y border-border/70 text-sm">
              {product.specifications.map((spec) => (
                <div key={spec.label} className="grid gap-1 py-3 sm:grid-cols-3">
                  <dt className="text-muted-foreground">{spec.label}</dt>
                  <dd className="text-foreground sm:col-span-2">{spec.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {product.delivery_information || product.care_information ? (
          <section className="mt-14 grid gap-8 sm:grid-cols-2">
            {product.delivery_information ? (
              <div className="rounded-xl border border-border/70 p-6">
                <h2 className="font-display text-lg text-foreground">Delivery</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {product.delivery_information}
                </p>
              </div>
            ) : null}
            {product.care_information ? (
              <div className="rounded-xl border border-border/70 p-6">
                <h2 className="font-display text-lg text-foreground">Care</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {product.care_information}
                </p>
              </div>
            ) : null}
          </section>
        ) : null}

        {product.faqs.length > 0 ? (
          <section className="mt-14 max-w-3xl">
            <h2 className="font-display text-2xl text-foreground">Questions</h2>
            <dl className="mt-4 space-y-5">
              {product.faqs.map((faq) => (
                <div key={faq.question}>
                  <dt className="font-medium text-foreground">{faq.question}</dt>
                  <dd className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {faq.answer}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        <ReviewPlacementSlot surface="product" className="mt-16" />

        {product.related.length > 0 ? (
          <section className="mt-16">
            <h2 className="font-display text-2xl text-foreground">More like this</h2>
            <ul className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
              {product.related.map((related) => (
                <li key={related.id}>
                  <ProductCard product={related} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-16 rounded-2xl border border-border/70 p-7 sm:p-9">
          <h2 className="font-display text-xl text-foreground">Need a hand before ordering?</h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Write to us and a person will reply. Returns, delivery and privacy terms are set out in
            full in the policy pages.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <a
              href={`mailto:${BRAND.supportEmail}`}
              className="inline-flex min-h-11 items-center rounded-lg border border-input px-5 text-sm font-medium text-foreground hover:bg-accent"
            >
              {BRAND.supportEmail}
            </a>
            <Link
              to="/legal"
              className="inline-flex min-h-11 items-center rounded-lg border border-input px-5 text-sm font-medium text-foreground hover:bg-accent"
            >
              Policies and trust
            </Link>
          </div>
        </section>
      </article>

      <div className="sticky bottom-0 z-30 mt-16 border-t border-border/70 bg-background/95 px-5 py-3 backdrop-blur sm:hidden">
        <a
          href={storeHref}
          className="flex min-h-12 items-center justify-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground"
        >
          View on the store
        </a>
      </div>
    </PublicShell>
  );
}
