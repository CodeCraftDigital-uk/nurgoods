import { useMemo, useState } from "react";
import { createFileRoute, Link, notFound, redirect } from "@tanstack/react-router";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { createCheckoutFn } from "@/lib/services/shopify-storefront.functions";
import { PublicShell } from "@/components/public/PublicShell";
import { Breadcrumbs } from "@/components/public/Breadcrumbs";
import { JsonLd } from "@/components/public/JsonLd";
import { Markdown } from "@/components/public/Markdown";
import { ProductCard } from "@/components/public/ProductCard";
import { resolvePriceDisplay } from "@/lib/pricing/display";

import { MissingProductImage } from "@/components/public/MissingProductImage";
import { ReviewPlacementSlot } from "@/components/public/ReviewPlacementSlot";
import { BRAND } from "@/lib/brand";
import { getStorefrontProductFn } from "@/lib/services/storefront.functions";
import { useBasket } from "@/lib/basket/BasketProvider";

export const Route = createFileRoute("/shop/$handle")({
  loader: async ({ params }) => {
    const product = await getStorefrontProductFn({ data: { handle: params.handle } });
    if (!product) throw notFound();
    // A listing proven identical to another is presented once. Old links move
    // permanently to the canonical listing so search authority stays together.
    if (product.duplicate_suppressed && product.duplicate_canonical_handle) {
      throw redirect({
        to: "/shop/$handle",
        params: { handle: product.duplicate_canonical_handle },
        statusCode: 301,
      });
    }
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
        ...(product.duplicate_suppressed ? [{ name: "robots", content: "noindex, follow" }] : []),
        { property: "og:url", content: url },
        { name: "twitter:card", content: "summary_large_image" },
        ...(product.image_url
          ? [
              { property: "og:image", content: product.image_url },
              { name: "twitter:image", content: product.image_url },
            ]
          : []),
      ],
      links: [
        {
          rel: "canonical",
          href: product.duplicate_canonical_handle
            ? `${BRAND.siteUrl}/shop/${product.duplicate_canonical_handle}`
            : url,
        },
      ],
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
            to="/store"
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

/** Builds a basket link on the store host so payment stays with the store. */
function cartHref(domain: string | null, variantId: string | null, quantity: number): string | null {
  if (!domain || !variantId) return null;
  return `https://${domain}/cart/${variantId}:${Math.max(1, Math.min(quantity, 10))}`;
}

function ProductDetail() {
  const { product } = Route.useLoaderData();
  const [activeIndex, setActiveIndex] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const gallery = useMemo(() => {
    const items = [...product.media];
    if (items.length === 0 && product.image_url) {
      items.push({ url: product.image_url, alt: product.title, width: null, height: null });
    }
    return items;
  }, [product]);

  const purchasable = useMemo(
    () => product.variants.filter((variant) => variant.variant_id),
    [product.variants],
  );
  const optionNames = useMemo(() => {
    const names: string[] = [];
    for (const variant of purchasable) {
      for (const option of variant.selected_options) {
        if (!names.includes(option.name)) names.push(option.name);
      }
    }
    return names;
  }, [purchasable]);

  const defaultVariant = useMemo(
    () => purchasable.find((variant) => variant.available_for_sale !== false) ?? purchasable[0] ?? null,
    [purchasable],
  );
  const [selection, setSelection] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const option of defaultVariant?.selected_options ?? []) initial[option.name] = option.value;
    return initial;
  });

  const selectedVariant = useMemo(() => {
    if (optionNames.length === 0) return defaultVariant;
    return (
      purchasable.find((variant) =>
        optionNames.every(
          (name) =>
            variant.selected_options.find((option) => option.name === name)?.value ===
            selection[name],
        ),
      ) ?? null
    );
  }, [purchasable, optionNames, selection, defaultVariant]);

  const activeImage =
    gallery[Math.min(activeIndex, Math.max(gallery.length - 1, 0))] ??
    (selectedVariant?.image_url
      ? { url: selectedVariant.image_url, alt: product.title, width: null, height: null }
      : null);
  const soldOut = selectedVariant ? selectedVariant.available_for_sale === false : false;
  const variantId = selectedVariant?.variant_id ?? null;
  const buyHref = product.checkout_ready ? cartHref(product.checkout_domain, variantId, quantity) : null;
  const headlessReady = product.storefront_checkout && Boolean(variantId);
  const canBuy = (headlessReady || Boolean(buyHref)) && !soldOut;
  const unavailableReason = soldOut
    ? "Currently unavailable"
    : !headlessReady && !product.checkout_ready
      ? "Checkout is being set up"
      : "Currently unavailable";

  const basket = useBasket();
  const addToBasket = () => {
    if (!selectedVariant?.variant_id) return;
    const added = basket.add({
      variantId: selectedVariant.variant_id,
      productHandle: product.handle,
      productTitle: product.title,
      options: selectedVariant.selected_options,
      variantTitle: selectedVariant.title ?? null,
      price: selectedVariant.price ?? null,
      compareAtPrice: selectedVariant.compare_at_price ?? null,
      currency: selectedVariant.currency ?? product.currency ?? null,
      imageUrl: selectedVariant.image_url ?? product.image_url ?? null,
      quantity,
      availableForSale: selectedVariant.available_for_sale,
    });
    if (added) toast.success(`${product.title} added to your basket`);
  };

  const [starting, setStarting] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const startCheckout = useServerFn(createCheckoutFn);
  const beginCheckout = async () => {
    if (!variantId || starting) return;
    setStarting(true);
    setCheckoutError(null);
    try {
      const result = await startCheckout({ data: { variantId, quantity } });
      if (result?.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
        return;
      }
      throw new Error("No checkout link");
    } catch (error) {
      setStarting(false);
      if (buyHref) {
        window.location.assign(buyHref);
        return;
      }
      const message =
        error instanceof Error && error.message && error.message.length < 160
          ? error.message
          : "Checkout could not be started. Please try again.";
      setCheckoutError(message);
      toast.error(message);
    }
  };


  // One shared pricing helper drives every price on the page, so a range can
  // never be rendered alongside a stale variant price.
  const display = resolvePriceDisplay(product, selectedVariant, { rangeStyle: "from" });

  const availabilityLabel = selectedVariant
    ? selectedVariant.available_for_sale === false
      ? "Currently unavailable"
      : "Available to order"
    : product.available_for_sale == null
      ? null
      : product.available_for_sale
        ? product.variant_count > 1
          ? `Available to order in ${product.variant_count} options`
          : "Available to order"
        : "Currently unavailable";

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
      ...(product.category_name
        ? { category: product.category_path.map((node) => node.name).join(" > ") }
        : product.product_type
          ? { category: product.product_type }
          : {}),
      ...(product.price_min != null
        ? {
            offers:
              product.price_max != null && product.price_max > product.price_min
                ? {
                    "@type": "AggregateOffer",
                    lowPrice: product.price_min,
                    highPrice: product.price_max,
                    offerCount: product.variant_count,
                    priceCurrency: product.currency ?? "GBP",
                    url,
                  }
                : {
                    "@type": "Offer",
                    price: product.price_min,
                    priceCurrency: product.currency ?? "GBP",
                    url,
                    ...(product.available_for_sale === true
                      ? { availability: "https://schema.org/InStock" }
                      : product.available_for_sale === false
                        ? { availability: "https://schema.org/OutOfStock" }
                        : {}),
                  },
          }
        : {}),

    },
  ];
  if (product.category_path.length > 0) {
    schema.push({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Store", item: `${BRAND.siteUrl}/store` },
        ...product.category_path.map((node, index) => ({
          "@type": "ListItem",
          position: index + 2,
          name: node.name,
          item: `${BRAND.siteUrl}/store?category=${encodeURIComponent(node.slug)}`,
        })),
        {
          "@type": "ListItem",
          position: product.category_path.length + 2,
          name: product.title,
          item: url,
        },
      ],
    });
  }
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

      <article className="mx-auto w-full max-w-7xl px-5 pt-10 sm:px-8 sm:pt-14">
        <Breadcrumbs
          items={[
            { label: "Store", href: "/store" },
            ...product.category_path.map((node) => ({
              label: node.name,
              href: `/store?category=${encodeURIComponent(node.slug)}`,
            })),
            { label: product.title },
          ]}
        />

        <div className="mt-6 grid gap-10 lg:grid-cols-2 lg:gap-14">
          <div>
            <div className="overflow-hidden glass-card rounded-3xl">
              {activeImage ? (
                <img
                  src={activeImage.url}
                  alt={activeImage.alt ?? product.title}
                  width={activeImage.width ?? 1200}
                  height={activeImage.height ?? 1200}
                  decoding="async"
                  className="aspect-square w-full bg-background object-contain"
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
                        index === activeIndex ? "border-brand" : "border-border/70 hover:border-brand/50"
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

          <div className="glass-panel h-fit rounded-3xl p-5 sm:p-7 lg:sticky lg:top-28">

            {product.category_name ? (
              <Link
                to="/store"
                search={{ category: product.category_slug ?? undefined } as never}
                className="inline-flex items-center rounded-full border border-border px-3 py-1 text-[0.7rem] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
              >
                {product.category_name}
              </Link>
            ) : product.product_type ? (
              <p className="text-[0.68rem] uppercase tracking-[0.22em] text-muted-foreground">
                {product.product_type}
              </p>
            ) : null}
            <h1 className="mt-2 font-display text-3xl leading-tight text-foreground sm:text-4xl">
              {product.title}
            </h1>
            {display.primary ? (
              <p
                aria-live="polite"
                className="mt-4 flex flex-wrap items-baseline gap-3 text-foreground"
              >
                <span className="font-display text-3xl font-bold tracking-tight">
                  {display.primary}
                </span>
                {display.compareAt ? (
                  <>
                    <span className="text-base text-muted-foreground">
                      {display.compareAtLabel}{" "}
                      <span className="line-through">{display.compareAt}</span>
                    </span>
                    {display.isReduced && display.savingPercent ? (
                      <span className="rounded-full bg-gold px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-gold-foreground">
                        Save {display.savingPercent}%
                      </span>
                    ) : null}
                  </>
                ) : null}

              </p>
            ) : null}
            {display.isRange ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Price depends on the option you choose.
              </p>
            ) : null}
            {availabilityLabel ? (
              <p className="mt-3 text-sm text-muted-foreground">{availabilityLabel}</p>
            ) : null}

            {product.summary ? (
              <p className="mt-5 text-base leading-relaxed text-muted-foreground">
                {product.summary}
              </p>
            ) : null}

            {optionNames.length > 0 ? (
              <div className="mt-7 space-y-5">
                {optionNames.map((name) => {
                  const values: string[] = [];
                  for (const variant of purchasable) {
                    const value = variant.selected_options.find((o) => o.name === name)?.value;
                    if (value && !values.includes(value)) values.push(value);
                  }
                  return (
                    <div key={name}>
                      <h2 className="text-[0.68rem] uppercase tracking-[0.22em] text-muted-foreground">
                        {name}
                      </h2>
                      <ul className="mt-2.5 flex flex-wrap gap-2">
                        {values.map((value) => {
                          const active = selection[name] === value;
                          const outOfStock = purchasable
                            .filter((variant) =>
                              variant.selected_options.some(
                                (o) => o.name === name && o.value === value,
                              ),
                            )
                            .every((variant) => variant.available_for_sale === false);
                          return (
                            <li key={value}>
                              <button
                                type="button"
                                aria-pressed={active}
                                onClick={() => setSelection((prev) => ({ ...prev, [name]: value }))}
                                className={`inline-flex min-h-10 items-center rounded-lg border px-3.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                                  active
                                    ? "border-brand bg-brand-soft text-foreground"
                                    : "border-border bg-surface text-foreground hover:border-brand/60"
                                } ${outOfStock ? "text-muted-foreground line-through" : ""}`}
                              >
                                {value}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            ) : null}

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <label htmlFor="quantity" className="sr-only">
                Quantity
              </label>
              <select
                id="quantity"
                value={quantity}
                onChange={(event) => setQuantity(Number(event.target.value))}
                className="min-h-12 rounded-lg border border-input bg-background px-3 text-sm text-foreground"
              >
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>

              {canBuy ? (
                <button
                  type="button"
                  onClick={addToBasket}
                  className="inline-flex min-h-12 flex-1 items-center justify-center rounded-2xl bg-primary px-6 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 sm:flex-none"
                >
                  Add to basket
                </button>
              ) : null}

              {canBuy ? (
                headlessReady ? (
                  <button
                    type="button"
                    onClick={() => void beginCheckout()}
                    disabled={starting}
                    className="inline-flex min-h-12 flex-1 items-center justify-center rounded-2xl border border-input bg-surface px-6 text-sm font-semibold text-foreground transition-colors hover:bg-accent disabled:opacity-70 sm:flex-none"
                  >
                    {starting ? "Opening checkout" : "Buy now"}
                  </button>
                ) : (
                  <a
                    href={buyHref!}
                    className="inline-flex min-h-12 flex-1 items-center justify-center rounded-2xl border border-input bg-surface px-6 text-sm font-semibold text-foreground transition-colors hover:bg-accent sm:flex-none"
                  >
                    Buy now
                  </a>
                )
              ) : (
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  className="inline-flex min-h-12 flex-1 cursor-not-allowed items-center justify-center rounded-lg border border-input px-6 text-sm font-medium text-muted-foreground sm:flex-none"
                >
                  {unavailableReason}
                </button>
              )}
            </div>
            {checkoutError ? (
              <p role="alert" className="mt-3 text-xs text-destructive">
                {checkoutError}
              </p>
            ) : null}
            {selectedVariant && optionNames.length > 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">
                Selected: {selectedVariant.selected_options.map((o) => o.value).join(" / ")}
              </p>
            ) : null}
            {optionNames.length > 0 && !selectedVariant ? (
              <p className="mt-3 text-xs text-muted-foreground">
                That combination is not offered. Choose another option.
              </p>
            ) : null}
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Payment, delivery options and order tracking are handled securely on the {BRAND.name}{" "}
              store. Full terms are set out in the policy pages.
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
            <h2 className="font-display text-2xl text-foreground">Product details</h2>
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
              <div className="glass-card rounded-2xl p-6">
                <h2 className="font-display text-lg text-foreground">Delivery</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {product.delivery_information}
                </p>
              </div>
            ) : null}
            {product.care_information ? (
              <div className="glass-card rounded-2xl p-6">
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

        <ReviewPlacementSlot surface="product_page" className="mt-16" />

        {product.related.length > 0 ? (
          <section className="mt-16">
            <h2 className="font-display text-2xl text-foreground">More like this</h2>
            <ul className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {product.related.map((related) => (
                <li key={related.id}>
                  <ProductCard product={related} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-16 glass-card rounded-3xl p-7 sm:p-9">
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

      {/* Mobile buy bar. Basket first, with the direct checkout kept secondary
          so the verified multi line basket flow stays the default path. */}
      <div className="sticky bottom-0 z-30 mt-16 border-t border-border/70 bg-background/95 px-5 py-3 backdrop-blur sm:hidden">
        {canBuy ? (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={addToBasket}
              className="flex min-h-12 flex-1 items-center justify-center rounded-2xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
            >
              Add to basket
            </button>
            {headlessReady ? (
              <button
                type="button"
                onClick={() => void beginCheckout()}
                disabled={starting}
                className="flex min-h-12 shrink-0 items-center justify-center rounded-2xl border border-input bg-surface px-4 text-sm font-semibold text-foreground disabled:opacity-70"
              >
                {starting ? "Opening" : "Buy now"}
              </button>
            ) : (
              <a
                href={buyHref!}
                className="flex min-h-12 shrink-0 items-center justify-center rounded-2xl border border-input bg-surface px-4 text-sm font-semibold text-foreground"
              >
                Buy now
              </a>
            )}
          </div>
        ) : (
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="flex w-full min-h-12 cursor-not-allowed items-center justify-center rounded-2xl border border-input px-5 text-sm font-medium text-muted-foreground"
          >
            {unavailableReason}
          </button>
        )}
      </div>
    </PublicShell>
  );
}
