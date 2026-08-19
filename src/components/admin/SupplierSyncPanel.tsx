import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { SectionCard } from "@/components/admin/SectionCard";
import { StatusPill } from "@/components/admin/StatusPill";
import { Button } from "@/components/ui/button";
import {
  previewSupplierRefresh,
  runSupplierRefreshFn,
  type SupplierSyncSnapshot,
} from "@/lib/zendrop/zendrop.functions";

const STATE_LABEL: Record<string, string> = {
  pending: "Not yet reconciled",
  healthy: "Confirmed with the supplier",
  repriced: "Repriced from a new supplier cost",
  held_unavailable: "Off sale, no supplier stock",
  held_undeliverable: "Off sale, no deliverable market",
  held_unprofitable: "Off sale, price cannot be evidenced",
  held_stale: "Off sale, supplier facts went stale",
  error: "Read failed, retrying",
};

function tone(state: string): "positive" | "warning" | "neutral" {
  if (state === "healthy" || state === "repriced") return "positive";
  if (state.startsWith("held") || state === "error") return "warning";
  return "neutral";
}

function ago(iso: string | null): string {
  if (!iso) return "never";
  const hours = (Date.now() - Date.parse(iso)) / 3_600_000;
  if (!Number.isFinite(hours)) return "never";
  if (hours < 1) return "under an hour ago";
  if (hours < 48) return `${Math.round(hours)} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/**
 * Supplier health for listings that are already on sale. Reconciliation runs
 * automatically on a schedule; the controls here only let an operator preview
 * or bring forward the next pass.
 */
export function SupplierSyncPanel({ snapshot }: { snapshot: SupplierSyncSnapshot | undefined }) {
  const queryClient = useQueryClient();
  const previewFn = useServerFn(previewSupplierRefresh);
  const runFn = useServerFn(runSupplierRefreshFn);

  const preview = useMutation({
    mutationFn: () => previewFn({ data: { batchSize: 10 } }),
    onSuccess: (result) => toast.success(result.message),
    onError: (error: Error) => toast.error(error.message),
  });

  const run = useMutation({
    mutationFn: () => runFn({ data: { batchSize: 25 } }),
    onSuccess: (result) => {
      toast.success(result.message);
      void queryClient.invalidateQueries({ queryKey: ["sourcing-overview"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const states = Object.entries(snapshot?.byState ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <SectionCard
      title="Supplier product health"
      description="Every listing already on sale is re-read from the supplier on a rolling schedule. Cost changes are repriced, and anything that cannot be evidenced as in stock, deliverable and profitable is taken off sale automatically."
      actions={
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => preview.mutate()}
            disabled={preview.isPending}
          >
            <Search className="mr-2 h-4 w-4" /> Preview
          </Button>
          <Button size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
            <RefreshCw className="mr-2 h-4 w-4" /> Reconcile now
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border/60 p-4">
          <p className="text-2xl font-semibold">{snapshot?.total ?? 0}</p>
          <p className="text-sm text-muted-foreground">Supplier backed listings</p>
        </div>
        <div className="rounded-xl border border-border/60 p-4">
          <p className="text-2xl font-semibold">{snapshot?.stale ?? 0}</p>
          <p className="text-sm text-muted-foreground">Awaiting a fresh reading</p>
        </div>
        <div className="rounded-xl border border-border/60 p-4">
          <p className="text-2xl font-semibold">
            {(snapshot?.byState?.["healthy"] ?? 0) + (snapshot?.byState?.["repriced"] ?? 0)}
          </p>
          <p className="text-sm text-muted-foreground">Confirmed on the last pass</p>
        </div>
      </div>

      {states.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {states.map(([state, count]) => (
            <StatusPill key={state} tone={tone(state)}>
              {STATE_LABEL[state] ?? state}: {count}
            </StatusPill>
          ))}
        </div>
      ) : null}

      {snapshot && snapshot.recent.length > 0 ? (
        <ul className="mt-5 space-y-3">
          {snapshot.recent.slice(0, 8).map((row) => (
            <li
              key={row.supplierProductId}
              className="rounded-xl border border-border/60 p-3 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">Supplier product {row.supplierProductId}</span>
                <StatusPill tone={tone(row.state)}>
                  {STATE_LABEL[row.state] ?? row.state}
                </StatusPill>
              </div>
              <p className="mt-1 text-muted-foreground">
                {row.reason ?? "No reason recorded yet."}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Stock {row.inventory ?? "not reported"} - last read {ago(row.syncedAt)}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          No supplier reconciliation has run yet. The scheduled pass will populate this.
        </p>
      )}
    </SectionCard>
  );
}
