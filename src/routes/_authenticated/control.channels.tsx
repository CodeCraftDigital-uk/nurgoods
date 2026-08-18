import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, CheckCircle2, Radio, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { SectionCard } from "@/components/admin/SectionCard";
import { EmptyState } from "@/components/admin/EmptyState";
import { StatusPill } from "@/components/admin/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getPublicationConsole,
  migratePublicationsFn,
  runPublicationAuditFn,
} from "@/lib/zendrop/publication.functions";

export const Route = createFileRoute("/_authenticated/control/channels")({
  component: ChannelsPage,
});

function ChannelsPage() {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState("");
  const [productId, setProductId] = useState("");

  const consoleFn = useServerFn(getPublicationConsole);
  const view = useQuery({
    queryKey: ["publication-console"],
    queryFn: () => consoleFn({}),
    retry: false,
  });

  const auditFn = useServerFn(runPublicationAuditFn);
  const audit = useMutation({
    mutationFn: () =>
      auditFn({
        data: productId.trim() ? { limit: 50, shopifyProductId: productId.trim() } : { limit: 50 },
      }),
    onSuccess: (result) => {
      toast.success(
        `Dry run complete. ${result.inspected} inspected, ${result.drifted} drifted. Nothing was changed.`,
      );
      void queryClient.invalidateQueries({ queryKey: ["publication-console"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "The audit failed"),
  });

  const migrateFn = useServerFn(migratePublicationsFn);
  const migrate = useMutation({
    mutationFn: () =>
      migrateFn({
        data: productId.trim()
          ? { confirm, limit: 10, shopifyProductId: productId.trim() }
          : { confirm, limit: 10 },
      }),
    onSuccess: (result) => {
      toast.success(`Reconciled ${result.changed} of ${result.inspected} products.`);
      setConfirm("");
      void queryClient.invalidateQueries({ queryKey: ["publication-console"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "The migration did not run"),
  });

  const checklist = view.data?.checklist;
  const lastRun = view.data?.lastRun ?? null;
  const items = view.data?.lastItems ?? [];
  const drifted = items.filter((item) => item.drifted);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sales channels"
        description="NUR GOODS is the only shopping storefront. Products belong on the headless channel and nowhere else."
      />

      <SectionCard
        title="Desired channel state"
        description="Resolved live from the store by channel name, never from a stored id."
        icon={Radio}
      >
        {checklist?.problem ? (
          <EmptyState
            icon={ShieldAlert}
            title="The channels could not be read"
            description={checklist.problem}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel</TableHead>
                <TableHead>Desired</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(checklist?.channels ?? []).map((channel) => (
                <TableRow key={channel.name}>
                  <TableCell className="font-medium">{channel.name}</TableCell>
                  <TableCell>
                    <StatusPill tone={channel.desired ? "success" : "neutral"}>
                      {channel.desired ? "On" : "Off"}
                    </StatusPill>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{channel.note}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      <SectionCard
        title="Audit and migration"
        description="The dry run only reads. A live reconciliation needs the confirmation phrase and runs in small batches."
        icon={CheckCircle2}
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
              placeholder="Optional single product id, gid://shopify/Product/..."
              aria-label="Single product id"
            />
            <Button
              variant="secondary"
              onClick={() => audit.mutate()}
              disabled={audit.isPending}
            >
              {audit.isPending ? "Auditing" : "Run dry run audit"}
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              placeholder="Type HEADLESS ONLY to confirm"
              aria-label="Migration confirmation"
            />
            <Button
              onClick={() => migrate.mutate()}
              disabled={migrate.isPending || confirm !== "HEADLESS ONLY"}
            >
              {migrate.isPending ? "Reconciling" : "Reconcile up to 10 products"}
            </Button>
          </div>
          {lastRun ? (
            <p className="text-sm text-muted-foreground">
              Last run {lastRun.mode === "dry_run" ? "dry run" : "live"} on{" "}
              {new Date(lastRun.createdAt).toLocaleString("en-GB")}. Inspected {lastRun.inspected},
              drifted {lastRun.drifted}, changed {lastRun.changed}.
            </p>
          ) : null}
        </div>
      </SectionCard>

      <SectionCard
        title="Drift"
        description="Products that are not on the headless channel only."
        icon={AlertTriangle}
      >
        {drifted.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="No drift recorded"
            description="Run a dry run audit to refresh this view."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Currently on</TableHead>
                <TableHead>Should be on</TableHead>
                <TableHead>Outcome</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {drifted.map((item) => (
                <TableRow key={item.shopifyProductId}>
                  <TableCell className="font-medium">{item.title ?? item.shopifyProductId}</TableCell>
                  <TableCell>{item.currentChannels.join(", ") || "None"}</TableCell>
                  <TableCell>{item.desiredChannels.join(", ")}</TableCell>
                  <TableCell className="text-muted-foreground">{item.message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      <SectionCard
        title="Post checkout return CTA"
        description="Branded 'Continue shopping at NUR GOODS' button on the Thank you and Order status pages."
        icon={ShieldAlert}
      >
        <div className="space-y-2 text-sm">
          <StatusPill tone="warning">Extension deployment required</StatusPill>
          <p className="text-muted-foreground">
            The extension source lives in the repository at{" "}
            <code>shopify/extensions/nur-goods-return-cta/</code>. It is not live. A person with
            store access has to deploy it with the Shopify CLI and place the block in the checkout
            editor, following the README in that folder. Nothing in this project can deploy it.
          </p>
        </div>
      </SectionCard>
    </div>
  );
}
