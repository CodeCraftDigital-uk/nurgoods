import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { SectionCard } from "@/components/admin/SectionCard";
import { StatusPill } from "@/components/admin/StatusPill";
import { Button } from "@/components/ui/button";
import { listShopifyLegalSources } from "@/lib/services/operations";
import { runShopifyLegalSync } from "@/lib/services/shopify-sync.functions";
import { reviewStatusLabel } from "@/lib/legal/source-content";

function tone(status: string): "positive" | "warning" | "danger" | "neutral" {
  if (status === "current") return "positive";
  if (status === "needs_review") return "warning";
  if (status === "sync_error") return "danger";
  return "neutral";
}

function when(value: string | null): string {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleString("en-GB");
}

/**
 * Control plane for legal documents imported from the store. The store stays
 * authoritative, so nothing here edits the wording. It reports freshness and
 * flags anything that must be corrected at the source before it can be public.
 */
export function LegalSourcesPanel() {
  const queryClient = useQueryClient();
  const sources = useQuery({ queryKey: ["legal-sources"], queryFn: listShopifyLegalSources });
  const syncFn = useServerFn(runShopifyLegalSync);

  const sync = useMutation({
    mutationFn: () => syncFn({}),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["legal-sources"] });
      await queryClient.invalidateQueries({ queryKey: ["integration-events"] });
      if (result.scopeAction) {
        toast.warning(result.scopeAction);
        return;
      }
      toast.success(
        `Imported ${result.imported} documents. ${result.publicVisible} are live and ${result.needsReview} need review.`,
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rows = sources.data ?? [];
  const lastSynced = rows.reduce<string | null>((latest, row) => {
    if (!latest || row.last_synced_at > latest) return row.last_synced_at;
    return latest;
  }, null);
  const needsReview = rows.filter((row) => row.review_status === "needs_review").length;
  const failures = rows.filter((row) => row.review_status === "sync_error").length;

  return (
    <SectionCard
      title="Imported from the store"
      description="Native store policies and published store pages. The store is the source of truth, so corrections are made there and pulled in here."
      actions={
        <Button onClick={() => sync.mutate()} disabled={sync.isPending} className="min-h-11">
          {sync.isPending ? "Syncing" : "Sync legal content"}
        </Button>
      }
    >
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: "Documents", value: String(rows.length) },
          { label: "Public", value: String(rows.filter((r) => r.public_visible).length) },
          { label: "Needs review", value: String(needsReview) },
          { label: "Sync errors", value: String(failures) },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border border-border p-3">
            <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
              {stat.label}
            </p>
            <p className="mt-1 font-display text-xl text-foreground">{stat.value}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Last successful sync: {when(lastSynced)}</p>

      {rows.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          Nothing imported yet. Run a sync once the store app has been released with
          read_legal_policies, read_content and read_online_store_pages.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-border">
          {rows.map((row) => (
            <li key={row.id} className="py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{row.title}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {row.source_type === "shop_policy" ? "Store policy" : "Store page"}
                    {row.policy_type ? ` · ${row.policy_type}` : ""} · Store updated{" "}
                    {when(row.shopify_updated_at)} · Synced {when(row.last_synced_at)}
                  </p>
                  <p className="mt-0.5 break-all text-xs text-muted-foreground">
                    {row.public_visible ? `Live at /legal/${row.slug}` : `Reserved /legal/${row.slug}`}
                    {row.source_url ? (
                      <>
                        {" · "}
                        <a
                          href={row.source_url}
                          className="underline underline-offset-2"
                          rel="noopener"
                        >
                          Store copy
                        </a>
                      </>
                    ) : null}
                  </p>
                </div>
                <StatusPill tone={tone(row.review_status)}>
                  {reviewStatusLabel(row.review_status)}
                </StatusPill>
              </div>

              {row.exclude_reason ? (
                <p className="mt-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                  {row.exclude_reason}
                </p>
              ) : null}
              {row.placeholder_tokens.length > 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Unresolved placeholders: {row.placeholder_tokens.slice(0, 6).join(", ")}
                </p>
              ) : null}
              {row.liquid_tokens.length > 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Store template variables: {row.liquid_tokens.slice(0, 6).join(", ")}
                </p>
              ) : null}
              {row.sync_error ? (
                <p className="mt-1 text-xs text-destructive">{row.sync_error}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
