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
      className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-border/70 bg-card transition-colors hover:border-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <div className="aspect-[4/3] w-full overflow-hidden bg-muted/50">
        {collection.image_url ? (
          <img
            src={collection.image_url}
            alt=""
            width={600}
            height={450}
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          />
        ) : null}
      </div>
      <div className="flex flex-1 flex-col justify-between gap-1 p-4">
        <h3 className="font-display text-base leading-snug text-foreground">{collection.title}</h3>
        {collection.product_count > 0 ? (
          <p className="text-xs text-muted-foreground">
            {collection.product_count} product{collection.product_count === 1 ? "" : "s"}
          </p>
        ) : null}
      </div>
    </Link>
  );
}

export function CollectionTileSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-border/70">
      <div className="aspect-[4/3] w-full animate-pulse bg-muted/50" />
      <div className="space-y-2 p-4">
        <div className="h-4 w-2/3 animate-pulse rounded bg-muted/60" />
        <div className="h-3 w-1/3 animate-pulse rounded bg-muted/60" />
      </div>
    </div>
  );
}
