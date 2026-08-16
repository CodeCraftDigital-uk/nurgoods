import { Link } from "@tanstack/react-router";
import type { StorefrontCollection } from "@/lib/public-api/storefront.server";

/**
 * Category tile. The image is either the store collection image or a genuine
 * product image from inside that collection. Nothing is generated.
 */
export function CollectionTile({
  collection,
  eager = false,
}: {
  collection: StorefrontCollection;
  eager?: boolean;
}) {
  return (
    <Link
      to="/collections/$handle"
      params={{ handle: collection.handle }}
      className="glass-card group relative flex h-full flex-col overflow-hidden rounded-2xl transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <div className="aspect-[4/3] w-full overflow-hidden bg-surface-muted">
        {collection.image_url ? (
          <img
            src={collection.image_url}
            alt=""
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
          {collection.title}
        </h3>
        {collection.product_count > 0 ? (
          <span className="shrink-0 rounded-full bg-brand-soft px-2.5 py-1 text-[0.68rem] font-semibold text-brand">
            {collection.product_count}
          </span>
        ) : null}
      </div>
    </Link>
  );
}

export function CollectionTileSkeleton() {
  return (
    <div className="glass-card overflow-hidden rounded-2xl">
      <div className="aspect-[4/3] w-full animate-pulse bg-surface-muted" />
      <div className="space-y-2 p-4">
        <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}
