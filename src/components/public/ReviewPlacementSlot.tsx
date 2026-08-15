import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPublicPlacements } from "@/lib/services/public-content.functions";

/**
 * Renders the review widget slot configured for a surface. The container and
 * placement key are stable so the review provider script can attach to them
 * once the account and embed details are supplied. Nothing renders when the
 * placement is disabled or has no widget reference, so no empty promises or
 * fabricated review content ever reach a visitor.
 */
export function ReviewPlacementSlot({
  surface,
  className,
}: {
  surface: string;
  className?: string;
}) {
  const fetchPlacements = useServerFn(listPublicPlacements);
  const placements = useQuery({
    queryKey: ["public-placements"],
    queryFn: () => fetchPlacements({}),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const placement = (placements.data ?? []).find(
    (item) => item.surface === surface && Boolean(item.widget_reference),
  );
  if (!placement) return null;

  return (
    <section
      className={className}
      aria-label={placement.label}
      data-review-placement={placement.placement_key}
      data-review-widget={placement.widget_reference ?? undefined}
    >
      <h2 className="font-display text-2xl text-foreground">{placement.label}</h2>
      {placement.description ? (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {placement.description}
        </p>
      ) : null}
      <div className="mt-5 rounded-xl border border-border/70 p-5" />
    </section>
  );
}
