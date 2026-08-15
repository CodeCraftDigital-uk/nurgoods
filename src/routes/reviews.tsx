import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PublicShell } from "@/components/public/PublicShell";
import { ReviewPlacementSlot } from "@/components/public/ReviewPlacementSlot";
import { BRAND } from "@/lib/brand";
import { listPublicPlacements } from "@/lib/services/public-content.functions";

export const Route = createFileRoute("/reviews")({
  head: () => ({
    meta: [
      { title: "Customer reviews | NUR GOODS" },
      {
        name: "description",
        content:
          "Verified customer reviews for NUR GOODS. Reviews are collected from real orders and published exactly as written.",
      },
      { property: "og:title", content: "Customer reviews | NUR GOODS" },
      {
        property: "og:description",
        content: "Read what NUR GOODS customers say about their orders and delivery experience.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReviewsPage,
});

function ReviewsPage() {
  const fetchPlacements = useServerFn(listPublicPlacements);
  const placements = useQuery({
    queryKey: ["public-placements"],
    queryFn: () => fetchPlacements({}),
    retry: false,
  });

  const ready = (placements.data ?? []).some(
    (item) => item.surface === "reviews_page" && item.widget_reference,
  );

  return (
    <PublicShell>
      <div className="mx-auto w-full max-w-3xl px-5 pt-14 sm:px-8 sm:pt-20">
        <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
          <Link to="/" className="hover:text-foreground">
            Home
          </Link>
          <span className="px-1.5">/</span>
          <span className="text-foreground">Reviews</span>
        </nav>
        <h1 className="mt-4 font-display text-4xl leading-tight text-foreground sm:text-5xl">
          Customer reviews
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">
          Reviews come from real orders placed through the {BRAND.name} store. Nothing here is
          written by us and nothing is edited.
        </p>

        {ready ? (
          <ReviewPlacementSlot surface="reviews_page" className="mt-12" />
        ) : placements.isLoading ? (
          <div className="mt-12 h-40 animate-pulse rounded-xl border border-border/70 bg-muted/40" />
        ) : (
          <div className="mt-12 rounded-xl border border-dashed border-border p-10 text-center">
            <h2 className="font-display text-xl text-foreground">Reviews are on their way</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              Verified reviews will appear here as orders are completed. We would rather show
              nothing than show reviews that are not genuine.
            </p>
            <a
              href={BRAND.storeUrl}
              className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Visit the store
            </a>
          </div>
        )}
      </div>
    </PublicShell>
  );
}
