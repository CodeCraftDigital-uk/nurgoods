import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/admin/PageHeader";
import { SectionCard } from "@/components/admin/SectionCard";
import { StatusPill } from "@/components/admin/StatusPill";
import { ProductCard, ProductCardSkeleton } from "@/components/public/ProductCard";
import { listStorefrontProductsFn } from "@/lib/services/storefront.functions";
import type { StorefrontProductCard } from "@/lib/public-api/storefront.server";

export const Route = createFileRoute("/_authenticated/admin/preview")({
  component: StorefrontPreviewPage,
});

/**
 * Admin only design fixtures. These never enter the public site, the public
 * API, the connector surface, the sitemap or structured data. They exist only
 * so the storefront layout can be judged before the store is paired, and they
 * disappear the moment real catalogue data is available.
 */
const PREVIEW_FIXTURES: StorefrontProductCard[] = [
  {
    id: "preview-1",
    handle: "preview-placeholder-1",
    title: "Preview layout card one",
    product_type: "Preview",
    vendor: null,
    tags: [],
    image_url: null,
    price_min: 24,
    price_max: null,
    currency: "GBP",
    variant_count: 1,
    compare_at_price_min: 32,
    available_for_sale: true,
    summary: "Demonstration content for layout review only. Not a real product.",
    updated_at: null,
  },
  {
    id: "preview-2",
    handle: "preview-placeholder-2",
    title: "Preview layout card two with a longer product title for wrapping",
    product_type: "Preview",
    vendor: null,
    tags: [],
    image_url: null,
    price_min: 48,
    price_max: 72,
    currency: "GBP",
    variant_count: 3,
    compare_at_price_min: null,
    available_for_sale: true,
    summary: "Demonstration content for layout review only. Not a real product.",
    updated_at: null,
  },
  {
    id: "preview-3",
    handle: "preview-placeholder-3",
    title: "Preview layout card three",
    product_type: null,
    vendor: null,
    tags: [],
    image_url: null,
    price_min: null,
    price_max: null,
    currency: "GBP",
    variant_count: 1,
    compare_at_price_min: null,
    available_for_sale: null,
    summary: null,
    updated_at: null,
  },
  {
    id: "preview-4",
    handle: "preview-placeholder-4",
    title: "Preview layout card four",
    product_type: "Preview",
    vendor: null,
    tags: [],
    image_url: null,
    price_min: 15,
    price_max: null,
    currency: "GBP",
    variant_count: 1,
    compare_at_price_min: null,
    available_for_sale: false,
    summary: "Demonstration content for layout review only. Not a real product.",
    updated_at: null,
  },
];

function StorefrontPreviewPage() {
  const listFn = useServerFn(listStorefrontProductsFn);
  const products = useQuery({
    queryKey: ["preview-products"],
    queryFn: () => listFn({ data: { limit: 8 } }),
    retry: false,
  });

  const live = products.data?.items ?? [];
  const usingFixtures = !products.isLoading && live.length === 0;
  const items = live.length > 0 ? live : PREVIEW_FIXTURES;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Design preview"
        title="Storefront preview"
        description="An internal view of the customer product grid. Real catalogue data is used as soon as a sync has run. Until then, clearly labelled demonstration cards stand in so the layout can be judged."
      />

      <SectionCard
        title="Product grid"
        actions={
          <StatusPill tone={usingFixtures ? "warning" : "positive"}>
            {usingFixtures ? "Preview data" : "Live catalogue data"}
          </StatusPill>
        }
        description={
          usingFixtures
            ? "No catalogue has synced yet. The cards below are demonstration placeholders and never appear on the public site."
            : "Rendered from genuine synced catalogue data."
        }
      >
        {usingFixtures ? (
          <p className="mb-5 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs font-medium uppercase tracking-[0.18em] text-warning">
            Preview only
          </p>
        ) : null}
        <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {products.isLoading
            ? Array.from({ length: 4 }).map((_, index) => (
                <li key={index}>
                  <ProductCardSkeleton />
                </li>
              ))
            : items.map((product) => (
                <li key={product.id} className={usingFixtures ? "pointer-events-none" : undefined}>
                  <ProductCard product={product} />
                </li>
              ))}
        </ul>
      </SectionCard>
    </div>
  );
}
