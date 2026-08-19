import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicShell } from "@/components/public/PublicShell";
import { PublikoEmbed } from "@/components/public/PublikoEmbed";
import { useReviewPlacement } from "@/components/public/ReviewPlacementSlot";
import { JsonLd } from "@/components/public/JsonLd";
import { BRAND } from "@/lib/brand";

/** Review specific answers. Every statement restates published policy. */
const REVIEW_FAQS: { question: string; answer: string }[] = [
  {
    question: "Are NUR GOODS reviews genuine?",
    answer:
      "Yes. Reviews come from real orders placed through the NUR GOODS store and are published by our review provider exactly as written. We do not write or edit them.",
  },
  {
    question: "Who can leave a review?",
    answer:
      "Reviews are collected from customers who have completed an order with NUR GOODS. Reviews are not accepted from people who have not bought from us.",
  },
  {
    question: "Are negative reviews removed?",
    answer:
      "No. Reviews are published as submitted by the customer, positive or negative. We would rather show nothing than show reviews that are not genuine.",
  },
];

export const Route = createFileRoute("/reviews")({
  head: () => ({
    meta: [
      { title: "Customer reviews from real NUR GOODS orders" },
      {
        name: "description",
        content:
          "Customer reviews for NUR GOODS, collected from real orders and published by our review provider exactly as written.",
      },
      { property: "og:title", content: "Customer reviews | NUR GOODS" },
      {
        property: "og:description",
        content: "Read what NUR GOODS customers say about their orders and delivery experience.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${BRAND.siteUrl}/reviews` },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: `${BRAND.siteUrl}/reviews` }],
  }),

  component: ReviewsPage,
});

function ReviewsPage() {
  // The Wall of Love widget is the review experience. We never substitute
  // written cards, star ratings or testimonials when it is absent.
  const { placement, isLoading } = useReviewPlacement("reviews_page");

  return (
    <PublicShell>
      <div className="mx-auto w-full max-w-5xl px-5 pt-14 sm:px-8 sm:pt-20">
        <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
          <Link to="/" className="hover:text-foreground">
            Home
          </Link>
          <span className="px-1.5">/</span>
          <span className="text-foreground">Reviews</span>
        </nav>
        <h1 className="mt-4 max-w-3xl font-display text-4xl leading-tight text-foreground sm:text-5xl">
          Customer reviews
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
          Reviews come from real orders placed through the {BRAND.name} store. Nothing here is
          written by us and nothing is edited.
        </p>

        {placement?.embed_snippet ? (
          <PublikoEmbed
            html={placement.embed_snippet}
            className="mt-12 pb-8"
            key={placement.placement_key}
          />
        ) : isLoading ? (
          <div className="mt-12 h-56 animate-pulse glass-card rounded-3xl bg-muted/40" />
        ) : (
          <div className="mt-12 rounded-2xl border border-dashed border-border p-10 text-center sm:p-14">
            <h2 className="font-display text-2xl text-foreground">Reviews coming soon</h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
              Verified reviews will appear here as orders are completed. We would rather show
              nothing than show reviews that are not genuine.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <a
                href={BRAND.storeUrl}
                className="inline-flex min-h-11 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Visit the store
              </a>
              <Link
                to="/store"
                className="inline-flex min-h-11 items-center rounded-lg border border-input px-5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
              >
                Browse the range
              </Link>
            </div>
          </div>
        )}
      </div>
    </PublicShell>
  );
}
