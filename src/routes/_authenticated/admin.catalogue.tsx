import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Boxes, Layers, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { SectionCard } from "@/components/admin/SectionCard";
import { EmptyState } from "@/components/admin/EmptyState";
import { StatusPill, statusTone, humanise } from "@/components/admin/StatusPill";
import { Button } from "@/components/ui/button";
import { listCollections, listEnrichment, listProducts } from "@/lib/services/catalogue";
import {
  getShopifyStatus,
  runShopifyCatalogueSync,
} from "@/lib/services/shopify-sync.functions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/admin/catalogue")({
  component: CataloguePage,
});

function CataloguePage() {
  const queryClient = useQueryClient();
  const products = useQuery({ queryKey: ["products"], queryFn: listProducts });
  const collections = useQuery({ queryKey: ["collections"], queryFn: listCollections });
  const enrichment = useQuery({ queryKey: ["enrichment"], queryFn: listEnrichment });

  const statusFn = useServerFn(getShopifyStatus);
  const shopify = useQuery({
    queryKey: ["shopify-status"],
    queryFn: () => statusFn({}),
    retry: false,
  });

  const syncFn = useServerFn(runShopifyCatalogueSync);
  const sync = useMutation({
    mutationFn: () => syncFn({}),
    onSuccess: (result) => {
      toast.success(
        `Synced ${result.products} products and ${result.collections} collections from Shopify.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["collections"] });
      void queryClient.invalidateQueries({ queryKey: ["integration-events"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Catalogue sync failed");
    },
  });

  const enrichmentByProduct = new Map(
    (enrichment.data ?? []).map((row) => [row.product_id, row]),
  );

  const lastSynced = (products.data ?? [])
    .map((p) => p.last_synced_at)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Catalogue Intelligence"
        title="Synced Shopify catalogue"
        description="A read only mirror of Shopify products and collections used for enrichment, SEO and future MCP resources. Shopify stays authoritative for pricing, inventory and orders, and Zendrop continues to fulfil."
      />

      <SectionCard
        title="Shopify Admin API sync"
        description="Pulls products and collections into the mirror. Nothing is ever written back to Shopify."
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
            Connected to {shopify.data.shopDomain} on Admin API {shopify.data.apiVersion}.{" "}
            {lastSynced
              ? `Last sync ${new Date(lastSynced).toLocaleString()}.`
              : "No sync has run yet."}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Sync is blocked until these server secrets are added:{" "}
            {(shopify.data?.missing ?? ["SHOPIFY_SHOP_DOMAIN", "SHOPIFY_ADMIN_API_TOKEN"]).join(
              ", ",
            )}
            . Optionally set SHOPIFY_API_VERSION to pin the Admin API version.
          </p>
        )}
      </SectionCard>


      <SectionCard
        title="Products"
        description="Rows appear after the Shopify Admin API sync is connected."
      >
        {(products.data ?? []).length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="No products synced yet"
            description="Connect the Shopify Admin API on the Integrations page. Products are mirrored read only and never edited from here."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Handle</TableHead>
                  <TableHead>Sync</TableHead>
                  <TableHead>Enrichment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(products.data ?? []).map((product) => {
                  const enriched = enrichmentByProduct.get(product.id);
                  return (
                    <TableRow key={product.id}>
                      <TableCell className="font-medium">{product.title}</TableCell>
                      <TableCell className="text-muted-foreground">{product.handle}</TableCell>
                      <TableCell>
                        <StatusPill tone={statusTone(product.sync_status)}>
                          {humanise(product.sync_status)}
                        </StatusPill>
                      </TableCell>
                      <TableCell>
                        <StatusPill tone={statusTone(enriched?.status)}>
                          {enriched ? humanise(enriched.status) : "Not started"}
                        </StatusPill>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Collections" description="Mirrored Shopify collections.">
        {(collections.data ?? []).length === 0 ? (
          <EmptyState
            icon={Layers}
            title="No collections synced yet"
            description="Collections arrive with the same Shopify sync and feed category pages, buying guides and internal linking."
          />
        ) : (
          <ul className="divide-y divide-border">
            {(collections.data ?? []).map((collection) => (
              <li key={collection.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium text-foreground">{collection.title}</p>
                  <p className="text-xs text-muted-foreground">{collection.handle}</p>
                </div>
                <StatusPill tone={statusTone(collection.sync_status)}>
                  {humanise(collection.sync_status)}
                </StatusPill>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="Enrichment coverage"
        description="Long form summary, benefits, use cases, specifications, delivery information and FAQs stored per product so descriptions are not limited by supplier copy."
      >
        <p className="text-sm text-muted-foreground">
          {(enrichment.data ?? []).length} enrichment record
          {(enrichment.data ?? []).length === 1 ? "" : "s"} stored. Enrichment is written by the AI
          workflow once the catalogue sync and an AI provider are connected.
        </p>
      </SectionCard>
    </div>
  );
}
