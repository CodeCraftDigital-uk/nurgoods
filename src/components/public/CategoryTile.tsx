import { Link } from "@tanstack/react-router";
import type { StorefrontCategory } from "@/lib/public-api/storefront.server";

/**
 * Category tile. Counts and cover images come from the local storefront
 * snapshot keyed by the canonical NUR taxonomy, so a supplier mis-labelled
 * product can never surface under the wrong aisle. The image always belongs to
 * a genuine member product of that category; nothing is generated.
 */
export function CategoryTile({
  category,
  eager = false,
}: {
  category: StorefrontCategory;
  eager?: boolean;
}) {
  return (
    <Link
      to="/category/$slug"
      params={{ slug: category.slug }}
      className="glass-card group relative flex h-full flex-col overflow-hidden rounded-2xl transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <div className="aspect-[4/3] w-full overflow-hidden bg-surface-muted">
        {category.image_url ? (
          <img
            src={category.image_url}
            alt={`${category.name} products`}
            width={600}
            height={450}
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
          />
        ) : null}
      </div>
      <div className="flex flex-1 items-center justify-between gap-3 p-4">
        <h3 className="min-w-0 truncate font-display text-[0.95rem] font-semibold text-foreground">
          {category.name}
        </h3>
        {category.product_count > 0 ? (
          <span className="shrink-0 rounded-full bg-brand-soft px-2.5 py-1 text-[0.68rem] font-semibold text-brand">
            {category.product_count}
          </span>
        ) : null}
      </div>
    </Link>
  );
}

export function CategoryTileSkeleton() {
  return (
    <div className="glass-card overflow-hidden rounded-2xl">
      <div className="aspect-[4/3] w-full animate-pulse bg-surface-muted" />
      <div className="space-y-2 p-4">
        <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}
