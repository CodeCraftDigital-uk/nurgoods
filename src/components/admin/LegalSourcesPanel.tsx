import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { SectionCard } from "@/components/admin/SectionCard";
import { StatusPill } from "@/components/admin/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { listShopifyLegalSources } from "@/lib/services/operations";
import { runShopifyLegalSync } from "@/lib/services/shopify-sync.functions";
import {
  acknowledgeUpstreamChange,
  discardLegalDraft,
  listLegalOverrideRevisions,
  listLegalOverrides,
  publishLegalOverride,
  revertLegalOverride,
  saveLegalOverrideDraft,
} from "@/lib/services/legal-override.functions";
import type { LegalOverrideRow } from "@/lib/services/legal-override.functions";
import { reviewStatusLabel } from "@/lib/legal/source-content";
import {
  canPublishOverride,
  overrideState,
  overrideStateLabel,
  overrideStateTone,
} from "@/lib/legal/override";

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

const ACTION_LABEL: Record<string, string> = {
  save_draft: "Draft saved",
  publish: "Override published",
  discard_draft: "Draft discarded",
  revert_to_source: "Reverted to store copy",
  acknowledge_upstream: "Upstream change reviewed",
};

/**
 * Control plane for legal documents imported from the store.
 *
 * The store copy is kept exactly as imported for reference, and an admin can
 * keep a separate local copy here for anything that needs correcting, such as
 * placeholder wording, company details, spelling or formatting. Local edits
 * are never written back to the store, and a later sync refreshes the imported
 * copy without touching local work.
 */
export function LegalSourcesPanel() {
  const queryClient = useQueryClient();
  const sources = useQuery({ queryKey: ["legal-sources"], queryFn: listShopifyLegalSources });
  const fetchOverrides = useServerFn(listLegalOverrides);
  const overrides = useQuery({
    queryKey: ["legal-overrides"],
    queryFn: () => fetchOverrides({}),
  });
  const syncFn = useServerFn(runShopifyLegalSync);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const [showUpstream, setShowUpstream] = useState(false);

  const rows = sources.data ?? [];
  const overrideBySource = useMemo(() => {
    const map = new Map<string, LegalOverrideRow>();
    for (const row of overrides.data ?? []) map.set(row.source_id, row);

    return map;
  }, [overrides.data]);

  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const selectedOverride = selectedId ? (overrideBySource.get(selectedId) ?? null) : null;

  const fetchRevisions = useServerFn(listLegalOverrideRevisions);
  const revisions = useQuery({
    queryKey: ["legal-override-revisions", selectedId],
    queryFn: () => fetchRevisions({ data: { sourceId: selectedId as string } }),
    enabled: Boolean(selectedId),
  });

  useEffect(() => {
    if (!selected) return;
    const override = overrideBySource.get(selected.id) ?? null;
    setTitle(override?.draft_title || selected.title);
    setSummary(override?.draft_summary ?? selected.body_summary ?? "");
    setBody(override?.draft_body_html || selected.body_html || "");
    setShowUpstream(false);
    // Only reload the editor when the selected document changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["legal-sources"] }),
      queryClient.invalidateQueries({ queryKey: ["legal-overrides"] }),
      queryClient.invalidateQueries({ queryKey: ["legal-override-revisions", selectedId] }),
      queryClient.invalidateQueries({ queryKey: ["public-legal-sources"] }),
    ]);
  }

  const sync = useMutation({
    mutationFn: () => syncFn({}),
    onSuccess: async (result) => {
      await refresh();
      await queryClient.invalidateQueries({ queryKey: ["integration-events"] });
      if (result.scopeAction) {
        toast.warning(result.scopeAction);
        return;
      }
      toast.success(
        `Imported ${result.imported} documents. Local copies were left untouched.`,
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const saveFn = useServerFn(saveLegalOverrideDraft);
  const publishFn = useServerFn(publishLegalOverride);
  const discardFn = useServerFn(discardLegalDraft);
  const revertFn = useServerFn(revertLegalOverride);
  const ackFn = useServerFn(acknowledgeUpstreamChange);

  const save = useMutation({
    mutationFn: () =>
      saveFn({ data: { sourceId: selectedId as string, title, summary, bodyHtml: body } }),
    onSuccess: async (result) => {
      setTitle(result.title);
      setSummary(result.summary);
      setBody(result.bodyHtml);
      await refresh();
      toast.success("Local draft saved. It is not public until you publish it.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const publish = useMutation({
    mutationFn: () => publishFn({ data: { sourceId: selectedId as string } }),
    onSuccess: async () => {
      await refresh();
      toast.success("Local copy published. It is now the version customers read.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const discard = useMutation({
    mutationFn: () => discardFn({ data: { sourceId: selectedId as string } }),
    onSuccess: async () => {
      await refresh();
      const override = selectedId ? overrideBySource.get(selectedId) : null;
      const restore = override?.published_body_html ?? selected?.body_html ?? "";
      setTitle(override?.published_title ?? selected?.title ?? "");
      setSummary(override?.published_summary ?? selected?.body_summary ?? "");
      setBody(restore);
      toast.success("Unpublished edits discarded.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const revert = useMutation({
    mutationFn: () => revertFn({ data: { sourceId: selectedId as string } }),
    onSuccess: async () => {
      await refresh();
      setTitle(selected?.title ?? "");
      setSummary(selected?.body_summary ?? "");
      setBody(selected?.body_html ?? "");
      toast.success("Local copy removed. The imported store wording applies again.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const acknowledge = useMutation({
    mutationFn: () => ackFn({ data: { sourceId: selectedId as string } }),
    onSuccess: async () => {
      await refresh();
      toast.success("Marked as reviewed against the latest store wording.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const lastSynced = rows.reduce<string | null>((latest, row) => {
    if (!latest || row.last_synced_at > latest) return row.last_synced_at;
    return latest;
  }, null);
  const overriddenCount = rows.filter((row) => {
    const state = overrideState(overrideBySource.get(row.id) ?? null, row.body_html ?? "");
    return state === "override_active" || state === "upstream_changed";
  }).length;
  const needsReview = rows.filter(
    (row) => row.review_status === "needs_review" && !overrideBySource.get(row.id)?.published_body_html,
  ).length;
  const failures = rows.filter((row) => row.review_status === "sync_error").length;
  const publicCount = rows.filter(
    (row) => row.public_visible || Boolean(overrideBySource.get(row.id)?.published_body_html),
  ).length;

  const selectedState = selected
    ? overrideState(selectedOverride, selected.body_html ?? "")
    : "no_override";
  const canPublish = canPublishOverride(title, body);
  const busy = save.isPending || publish.isPending || discard.isPending || revert.isPending;

  return (
    <div className="space-y-6">
      <SectionCard
        title="Imported from the store"
        description="Policies and published pages are imported from the store and kept here exactly as they arrived. You can edit the copy shown on this site without changing anything in the store."
        actions={
          <Button onClick={() => sync.mutate()} disabled={sync.isPending} className="min-h-11">
            {sync.isPending ? "Syncing" : "Sync legal content"}
          </Button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-5">
          {[
            { label: "Documents", value: String(rows.length) },
            { label: "Public", value: String(publicCount) },
            { label: "Local copies", value: String(overriddenCount) },
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
        <p className="mt-3 text-xs text-muted-foreground">
          Last successful sync: {when(lastSynced)}. A sync refreshes the imported copy only and
          never overwrites a local copy.
        </p>

        {rows.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">
            Nothing imported yet. Run a sync once the store app has been released with
            read_legal_policies, read_content and read_online_store_pages.
          </p>
        ) : (
          <ul className="mt-6 divide-y divide-border">
            {rows.map((row) => {
              const override = overrideBySource.get(row.id) ?? null;
              const state = overrideState(override, row.body_html ?? "");
              const isPublic = row.public_visible || Boolean(override?.published_body_html);
              return (
                <li key={row.id} className="py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {override?.published_title ?? row.title}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {row.source_type === "shop_policy" ? "Store policy" : "Store page"}
                        {row.policy_type ? ` · ${row.policy_type}` : ""} · Store updated{" "}
                        {when(row.shopify_updated_at)} · Synced {when(row.last_synced_at)}
                      </p>
                      <p className="mt-0.5 break-all text-xs text-muted-foreground">
                        {isPublic ? `Live at /legal/${row.slug}` : `Reserved /legal/${row.slug}`}
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
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill tone={overrideStateTone(state)}>
                        {overrideStateLabel(state)}
                      </StatusPill>
                      <StatusPill tone={tone(row.review_status)}>
                        {reviewStatusLabel(row.review_status)}
                      </StatusPill>
                      <Button
                        variant={row.id === selectedId ? "default" : "outline"}
                        onClick={() => setSelectedId(row.id)}
                        className="min-h-11"
                      >
                        {row.id === selectedId ? "Editing" : "Edit local copy"}
                      </Button>
                    </div>
                  </div>

                  {state === "no_override" && row.exclude_reason ? (
                    <p className="mt-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                      {row.exclude_reason} You can fix this here instead by editing the local copy.
                    </p>
                  ) : null}
                  {state === "upstream_changed" ? (
                    <p className="mt-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                      The store wording changed after this local copy was published. Compare them
                      and republish or mark as reviewed.
                    </p>
                  ) : null}
                  {row.placeholder_tokens.length > 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Unresolved placeholders in the store copy:{" "}
                      {row.placeholder_tokens.slice(0, 6).join(", ")}
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
              );
            })}
          </ul>
        )}
      </SectionCard>

      {selected ? (
        <SectionCard
          title={`Local copy: ${selected.title}`}
          description="This is the version customers read once published. Nothing here is sent back to the store."
          actions={
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => setShowUpstream((value) => !value)}
                className="min-h-11"
              >
                {showUpstream ? "Hide store copy" : "Compare store copy"}
              </Button>
              <a
                href={`/legal/${selected.slug}`}
                target="_blank"
                rel="noopener"
                className="inline-flex min-h-11 items-center rounded-md border border-border px-4 text-sm text-foreground"
              >
                Preview page
              </a>
            </div>
          }
        >
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="legal-title">Title</Label>
              <Input
                id="legal-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={300}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="legal-summary">Short summary shown under the title</Label>
              <Input
                id="legal-summary"
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                maxLength={600}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="legal-body">Body</Label>
              <Textarea
                id="legal-body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={18}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                Simple HTML is supported. Anything unsafe and any leftover store template variables
                are removed automatically when you save.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => save.mutate()} disabled={busy} className="min-h-11">
                {save.isPending ? "Saving" : "Save draft"}
              </Button>
              <Button
                variant="outline"
                onClick={() => save.mutate(undefined, { onSuccess: () => publish.mutate() })}
                disabled={busy || !canPublish}
                className="min-h-11"
              >
                {publish.isPending ? "Publishing" : "Publish override"}
              </Button>
              {selectedState === "upstream_changed" ? (
                <Button
                  variant="outline"
                  onClick={() => acknowledge.mutate()}
                  disabled={acknowledge.isPending}
                  className="min-h-11"
                >
                  Mark upstream reviewed
                </Button>
              ) : null}
              <Button
                variant="ghost"
                onClick={() => discard.mutate()}
                disabled={busy || !selectedOverride}
                className="min-h-11"
              >
                Discard local draft
              </Button>
              <Button
                variant="ghost"
                onClick={() => revert.mutate()}
                disabled={busy || !selectedOverride}
                className="min-h-11 text-destructive"
              >
                Revert to store copy
              </Button>
            </div>
            {!canPublish ? (
              <p className="text-xs text-muted-foreground">
                Add a title and at least a couple of paragraphs before publishing.
              </p>
            ) : null}
            {selectedOverride?.published_at ? (
              <p className="text-xs text-muted-foreground">
                Published locally on {when(selectedOverride.published_at)}. Last edited{" "}
                {when(selectedOverride.updated_at)}.
              </p>
            ) : null}

            {showUpstream ? (
              <div className="rounded-lg border border-border p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  Imported store copy, unchanged
                </p>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
                  {selected.body_html}
                </pre>
              </div>
            ) : null}

            {(revisions.data ?? []).length > 0 ? (
              <div className="rounded-lg border border-border p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                  Recent activity
                </p>
                <ul className="mt-2 space-y-1.5">
                  {(revisions.data ?? []).map((revision) => (
                    <li key={revision.id} className="text-xs text-muted-foreground">
                      {ACTION_LABEL[revision.action] ?? revision.action} ·{" "}
                      {when(revision.created_at)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}
