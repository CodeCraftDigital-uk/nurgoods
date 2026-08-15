import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PublikoEmbed } from "@/components/public/PublikoEmbed";
import { listPublicPlacements, type PublicPlacement } from "@/lib/services/public-content.functions";

/** Shared read of enabled placements. One query serves every slot on the page. */
export function useReviewPlacement(surface: string): {
  placement: PublicPlacement | null;
  isLoading: boolean;
} {
  const fetchPlacements = useServerFn(listPublicPlacements);
  const placements = useQuery({
    queryKey: ["public-placements"],
    queryFn: () => fetchPlacements({}),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const placement =
    (placements.data ?? []).find(
      (item) => item.surface === surface && Boolean(item.embed_snippet?.trim()),
    ) ?? null;

  return { placement, isLoading: placements.isLoading };
}

/**
 * Renders the review widget assigned to one surface. Each widget renders only
 * in the placement it was assigned to, and nothing at all renders when no
 * widget is configured, so no rating or testimonial is ever implied.
 */
export function ReviewPlacementSlot({
  surface,
  className,
  bare = false,
  headingLevel = "h2",
}: {
  surface: string;
  className?: string;
  bare?: boolean;
  headingLevel?: "h2" | "h3";
}) {
  const { placement } = useReviewPlacement(surface);
  if (!placement?.embed_snippet) return null;

  if (bare) {
    return (
      <div
        className={className}
        aria-label={placement.label}
        data-review-placement={placement.placement_key}
      >
        <PublikoEmbed html={placement.embed_snippet} />
      </div>
    );
  }

  const Heading = headingLevel;
  return (
    <section
      className={className}
      aria-label={placement.label}
      data-review-placement={placement.placement_key}
    >
      <Heading className="font-display text-2xl text-foreground">{placement.label}</Heading>
      {placement.description ? (
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
          {placement.description}
        </p>
      ) : null}
      <PublikoEmbed html={placement.embed_snippet} className="mt-6" />
    </section>
  );
}
