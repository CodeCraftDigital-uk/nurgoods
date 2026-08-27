import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Boxes, Layers, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { SectionCard } from "@/components/admin/SectionCard";
import { EmptyState } from "@/components/admin/EmptyState";
import { StatusPill, statusTone, humanise } from "@/components/admin/StatusPill";
import { MetricGrid, ProgressBar } from "@/components/admin/IntelligencePanels";
import { DuplicateIntelligence } from "@/components/admin/DuplicateIntelligence";
import { Button } from "@/components/ui/button";
import { listCollections, listProducts } from "@/lib/services/catalogue";
import { getShopifyStatus, runShopifyCatalogueSync } from "@/lib/services/shopify-sync.functions";
import {
  getCatalogueIntelligenceFn,
  requeueProductFn,
  runIntelligenceActionFn,
} from "@/lib/intelligence/intelligence.functions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/control/catalogue")({
  component: CataloguePage,
});

function CataloguePage() {
  const queryClient = useQueryClient();
  const products = useQuery({ queryKey: ["products"], queryFn: listProducts });
  const collections = useQuery({ queryKey: ["collections"], queryFn: listCollections });

  const statusFn = useServerFn(getShopifyStatus);
  const shopify = useQuery({
    queryKey: ["shopify-status"],
    queryFn: () => statusFn({}),
    retry: false,
  });

  const intelligenceFn = useServerFn(getCatalogueIntelligenceFn);
  const intelligence = useQuery({
    queryKey: ["catalogue-intelligence"],
    queryFn: () => intelligenceFn({}),
    retry: false,
    refetchInterval: 30_000,
  });

  const syncFn = useServerFn(runShopifyCatalogueSync);
  const sync = useMutation({
    mutationFn: () => syncFn({}),
    onSuccess: (result) => {
      toast.success(
        `Synced ${result.products} products and ${result.collections} collections from the store.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["collections"] });
      void queryClient.invalidateQueries({ queryKey: ["catalogue-intelligence"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Catalogue sync failed");
    },
  });

  const actionFn = useServerFn(runIntelligenceActionFn);
  const action = useMutation({
    mutationFn: (value: "backfill" | "maintenance" | "audit" | "retry_failed") =>
      actionFn({ data: { action: value } }),
    onSuccess: (result) => {
      toast.success(result.message);
      void queryClient.invalidateQueries({ queryKey: ["catalogue-intelligence"] });
      void queryClient.invalidateQueries({ queryKey: ["seo-intelligence"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "That run could not be completed");
    },
  });

  const requeueFn = useServerFn(requeueProductFn);
  const requeue = useMutation({
    mutationFn: (productId: string) =>
      requeueFn({ data: { productId, stage: "classify" as const } }),
    onSuccess: (result) => {
      toast.success(result.message);
      void queryClient.invalidateQueries({ queryKey: ["catalogue-intelligence"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "The product could not be reprocessed");
    },
  });

  const lastSynced = (products.data ?? [])
    .map((p) => p.last_synced_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  const data = intelligence.data;
  const busy = action.isPending;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Catalogue Intelligence"
        title="Canonical catalogue and category corrections"
        description="Supplier categories are never trusted for navigation. Every synced product is classified into the canonical NUR GOODS taxonomy automatically, with deterministic guardrails, and the storefront uses that corrected category. The store stays authoritative for price, stock, checkout and orders."
      />

      <SectionCard
        title="Store catalogue sync"
        description="Pulls products and collections into the mirror, then queues anything that materially changed for classification. Nothing is ever written back to the store."
        actions={
          <Button
            size="sm"
            disabled={!shopify.data?.configured || sync.isPending}
            onClick={() => sync.mutate()}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {sync.isPending ? "Syncing" : "Run sync"}
          </Button>
        }
      >
        {shopify.data?.configured ? (
          <p className="text-sm text-muted-foreground">
            Connected to {shopify.data.shopDomain}.{" "}
            {lastSynced
              ? `Last sync ${new Date(lastSynced).toLocaleString()}.`
              : "No sync has run yet."}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Sync is blocked until the store connection is completed in Integrations. Missing:{" "}
            {(shopify.data?.missing ?? ["Store domain", "Client ID", "Client secret"]).join(", ")}.
          </p>
        )}
      </SectionCard>

      <SectionCard
        title="Classification health"
        description="Automatic. High confidence results apply straight away, medium confidence uses the nearest safe parent, and low confidence falls back to a broader category and is flagged rather than guessed."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => action.mutate("backfill")}
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              Backfill batch
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => action.mutate("maintenance")}
            >
              Run maintenance
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => action.mutate("audit")}
            >
              Run audit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => action.mutate("retry_failed")}
            >
              Retry failed
            </Button>
          </div>
        }
      >
        {intelligence.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading intelligence state.</p>
        ) : !data ? (
          <p className="text-sm text-muted-foreground">
            Intelligence state is unavailable at the moment.
          </p>
        ) : (
          <div className="space-y-5">
            <MetricGrid
              items={[
                { label: "Catalogue health", value: `${data.totals.healthPercent}%` },
                {
                  label: "Classified",
                  value: `${data.totals.classified} / ${data.totals.products}`,
                },
                { label: "High confidence", value: data.totals.high },
                { label: "Medium confidence", value: data.totals.medium },
                { label: "Low confidence", value: data.totals.low },
                { label: "Anomalies", value: data.totals.anomalies },
                { label: "Needs attention", value: data.totals.needsAttention },
                { label: "Duplicate suspects", value: data.totals.duplicates },
              ]}
            />
            <ProgressBar percent={data.backfill.percent} label="Backfill progress" />
            <p className="text-xs text-muted-foreground">
              {data.backfill.queued} queued, {data.backfill.failed} failed, average merchandising
              quality {data.totals.averageQuality}.{" "}
              {data.lastRun.at
                ? `Last automatic run ${new Date(data.lastRun.at).toLocaleString()}: ${data.lastRun.message ?? data.lastRun.status ?? ""}`
                : "No automatic run has completed yet."}
            </p>
          </div>
        )}
      </SectionCard>

      <DuplicateIntelligence />

      <SectionCard
        title="Recent category corrections"
        description="Every change from the supplier category to the canonical category is recorded with its reason."
      >
        {(data?.recentCorrections ?? []).length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="No corrections recorded yet"
            description="Corrections appear here as soon as the classifier reassigns a product away from its supplier category."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Supplier said</TableHead>
                  <TableHead>Canonical category</TableHead>
                  <TableHead>Confidence</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.recentCorrections ?? []).map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.product_title}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.supplier_category ?? "Not set"}
                    </TableCell>
                    <TableCell>{row.new_category_slug ?? "Unresolved"}</TableCell>
                    <TableCell>
                      {row.confidence == null ? "" : `${Math.round(row.confidence * 100)}%`}
                    </TableCell>
                    <TableCell className="max-w-sm text-xs text-muted-foreground">
                      {row.reason ?? ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Needs attention"
        description="Flagged products stay on sale. They are simply held in a broader category until the evidence is strong enough for a specific one."
      >
        {(data?.attention ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing is flagged. Every classified product sits in a confident canonical category.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {(data?.attention ?? []).map((row) => (
              <li
                key={row.product_id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{row.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {row.category_slug ?? "Unresolved"} at {Math.round(row.confidence * 100)}%
                    confidence
                    {row.anomalies.length > 0
                      ? `, flags: ${row.anomalies.map((flag) => flag.label).join(", ")}`
                      : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={requeue.isPending}
                  onClick={() => requeue.mutate(row.product_id)}
                >
                  Reclassify
                </Button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="Category distribution"
        description="Where the catalogue currently sits inside the canonical taxonomy."
      >
        {(data?.distribution ?? []).length === 0 ? (
          <EmptyState
            icon={Layers}
            title="No canonical categories in use yet"
            description="Distribution appears once the first classification pass has run."
          />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(data?.distribution ?? []).map((row) => (
              <li
                key={row.slug}
                className="flex items-center justify-between rounded-lg border border-border/70 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm text-foreground">{row.name}</p>
                  {row.parent_slug ? (
                    <p className="text-xs text-muted-foreground">in {row.parent_slug}</p>
                  ) : null}
                </div>
                <span className="text-sm text-muted-foreground">{row.products}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="Mirrored records"
        description="Read only copies of store products and collections. The store remains the source of truth."
      >
        {(products.data ?? []).length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="No products synced yet"
            description="Connect the store on the Integrations page. Products are mirrored read only and never edited from here."
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-border/70 p-4">
              <p className="text-sm text-foreground">{(products.data ?? []).length} products</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {(products.data ?? []).filter((product) => product.sync_status === "synced").length}{" "}
                currently marked synced.
              </p>
            </div>
            <div className="rounded-lg border border-border/70 p-4">
              <p className="text-sm text-foreground">
                {(collections.data ?? []).length} store collections
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Collections still feed merchandising, but navigation uses the canonical taxonomy.
              </p>
            </div>
          </div>
        )}
      </SectionCard>

      {(products.data ?? []).length > 0 ? (
        <SectionCard title="Products" description="The mirrored catalogue with its sync state.">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Handle</TableHead>
                  <TableHead>Supplier category</TableHead>
                  <TableHead>Sync</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(products.data ?? []).slice(0, 100).map((product) => (
                  <TableRow key={product.id}>
                    <TableCell className="font-medium">{product.title}</TableCell>
                    <TableCell className="text-muted-foreground">{product.handle}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {product.product_type ?? "Not set"}
                    </TableCell>
                    <TableCell>
                      <StatusPill tone={statusTone(product.sync_status)}>
                        {humanise(product.sync_status)}
                      </StatusPill>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}
