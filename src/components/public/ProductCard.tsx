import { Link } from "@tanstack/react-router";
import { MissingProductImage } from "@/components/public/MissingProductImage";
import { formatMoney, productPriceDisplay } from "@/lib/pricing/display";
import type { StorefrontProductCard } from "@/lib/public-api/storefront.server";

/**
 * Legacy helper kept for callers that only need a formatted range string.
 * All new work should use the shared pricing display module directly.
 */
export function formatPrice(
  min: number | null,
  max: number | null,
  currency: string | null,
): string | null {
  if (min == null && max == null) return null;
  if (min != null && max != null && max > min) {
    return `${formatMoney(min, currency)} to ${formatMoney(max, currency)}`;
  }
  return formatMoney((min ?? max) as number, currency);
}

/**
 * Marketplace product card. Everything shown comes from synced store data or
 * approved enrichment. No badges, ratings or stock claims are invented.
 */
export function ProductCard({
  product,
  eager = false,
}: {
  product: StorefrontProductCard;
  eager?: boolean;
}) {
  // Multi price products advertise the lowest currently sellable price, so a
  // card can never imply a price the shopper cannot actually buy at.
  const display = productPriceDisplay(product, { rangeStyle: "from" });
  const reduced = display.isReduced;



  return (
    <Link
      to="/shop/$handle"
      params={{ handle: product.handle }}
      className="glass-card group flex h-full flex-col overflow-hidden rounded-2xl transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <div className="relative aspect-square w-full overflow-hidden bg-surface-muted">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.title}
            width={600}
            height={600}
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          />
        ) : (
          <MissingProductImage />
        )}
        {reduced ? (
          <span className="absolute left-3 top-3 rounded-full bg-gold px-2.5 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-gold-foreground shadow-sm">
            Reduced
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col p-4">
        {product.product_type ? (
          <p className="truncate text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-brand">
            {product.product_type}
          </p>
        ) : null}
        <h3 className="mt-1.5 line-clamp-2 font-display text-[0.95rem] font-semibold leading-snug text-foreground">
          {product.title}
        </h3>
        {product.summary ? (
          <p className="mt-1.5 line-clamp-2 text-[0.8rem] leading-relaxed text-muted-foreground">
            {product.summary}
          </p>
        ) : null}
        {display.primary ? (
          <p className="mt-auto flex flex-wrap items-baseline gap-2 pt-3">
            <span className="font-display text-lg font-bold tracking-tight text-foreground">
              {display.primary}
            </span>
            {display.compareAt ? (
              <span className="text-xs text-muted-foreground">
                {display.compareAtLabel}{" "}
                <span className="line-through">{display.compareAt}</span>
              </span>
            ) : null}

          </p>
        ) : null}

      </div>
    </Link>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="glass-card overflow-hidden rounded-2xl">
      <div className="aspect-square w-full animate-pulse bg-surface-muted" />
      <div className="space-y-2 p-4">
        <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
        <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
        <div className="h-5 w-1/4 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}
