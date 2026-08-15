import { Link } from "@tanstack/react-router";
import { MissingProductImage } from "@/components/public/MissingProductImage";
import type { StorefrontProductCard } from "@/lib/public-api/storefront.server";

/** Formats a synced price range. Returns null when the store has not supplied one. */
export function formatPrice(
  min: number | null,
  max: number | null,
  currency: string | null,
): string | null {
  if (min == null && max == null) return null;
  const code = currency ?? "GBP";
  const format = (value: number) =>
    new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: code,
      maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
    }).format(value);
  if (min != null && max != null && max > min) return `${format(min)} to ${format(max)}`;
  return format((min ?? max) as number);
}

/**
 * Product card. Everything shown comes from synced store data or approved
 * enrichment. No badges, ratings or stock claims are invented.
 */
export function ProductCard({
  product,
  eager = false,
}: {
  product: StorefrontProductCard;
  eager?: boolean;
}) {
  const price = formatPrice(product.price_min, product.price_max, product.currency);
  return (
    <Link
      to="/shop/$handle"
      params={{ handle: product.handle }}
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-border/70 bg-card transition-colors hover:border-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <div className="aspect-square w-full overflow-hidden bg-muted/50">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.title}
            width={600}
            height={600}
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <MissingProductImage />
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        {product.product_type ? (
          <p className="text-[0.65rem] uppercase tracking-[0.18em] text-muted-foreground">
            {product.product_type}
          </p>
        ) : null}
        <h3 className="mt-1.5 font-display text-base leading-snug text-foreground">
          {product.title}
        </h3>
        {product.summary ? (
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
            {product.summary}
          </p>
        ) : null}
        {price ? (
          <p className="mt-auto pt-3 text-sm font-medium text-foreground">{price}</p>
        ) : null}
      </div>
    </Link>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-border/70">
      <div className="aspect-square w-full animate-pulse bg-muted/50" />
      <div className="space-y-2 p-4">
        <div className="h-3 w-1/3 animate-pulse rounded bg-muted/60" />
        <div className="h-4 w-3/4 animate-pulse rounded bg-muted/60" />
      </div>
    </div>
  );
}
