import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { CollectionTile, CollectionTileSkeleton } from "@/components/public/CollectionTile";
import type { StorefrontCollection } from "@/lib/public-api/storefront.server";

/**
 * Category rail. Every populated category is reachable by swipe, by the arrow
 * controls or by keyboard, so the homepage can carry the whole taxonomy without
 * growing several screens tall. Data comes from the local storefront snapshot,
 * never from a live catalogue call.
 */
export function CategoryCarousel({
  collections,
  loading = false,
}: {
  collections: StorefrontCollection[];
  loading?: boolean;
}) {
  const track = useRef<HTMLUListElement | null>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  const syncEdges = useCallback(() => {
    const node = track.current;
    if (!node) return;
    setAtStart(node.scrollLeft <= 8);
    setAtEnd(node.scrollLeft + node.clientWidth >= node.scrollWidth - 8);
  }, []);

  useEffect(() => {
    syncEdges();
  }, [syncEdges, collections.length, loading]);

  const scrollBy = (direction: -1 | 1) => {
    const node = track.current;
    if (!node) return;
    node.scrollBy({ left: direction * Math.max(node.clientWidth * 0.9, 240), behavior: "smooth" });
  };

  const rowClasses =
    "grid grid-flow-col grid-rows-2 lg:grid-rows-3 auto-cols-[62%] sm:auto-cols-[38%] md:auto-cols-[30%] lg:auto-cols-[23%] xl:auto-cols-[18%] gap-3 sm:gap-4 overflow-x-auto scroll-smooth snap-x snap-mandatory pb-2 [scrollbar-width:thin]";

  if (loading) {
    return (
      <ul className={rowClasses} aria-busy="true">
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((index) => (
          <li key={index} className="snap-start">
            <CollectionTileSkeleton />
          </li>
        ))}
      </ul>
    );
  }

  if (collections.length === 0) return null;

  return (
    <div className="relative">
      <ul
        ref={track}
        onScroll={syncEdges}
        tabIndex={0}
        aria-label="Product categories"
        className={`${rowClasses} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`}
      >
        {collections.map((collection, index) => (
          <li key={collection.id} className="snap-start">
            <CollectionTile collection={collection} eager={index < 4} />
          </li>
        ))}
      </ul>

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => scrollBy(-1)}
          disabled={atStart}
          aria-label="Show previous categories"
          className="inline-flex size-10 items-center justify-center rounded-full border border-input bg-surface text-foreground transition-colors hover:border-brand/50 disabled:opacity-40"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => scrollBy(1)}
          disabled={atEnd}
          aria-label="Show more categories"
          className="inline-flex size-10 items-center justify-center rounded-full border border-input bg-surface text-foreground transition-colors hover:border-brand/50 disabled:opacity-40"
        >
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
