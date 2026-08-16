import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { SectionCard } from "@/components/admin/SectionCard";
import { EmptyState } from "@/components/admin/EmptyState";
import { MetricGrid } from "@/components/admin/IntelligencePanels";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getDuplicateOverviewFn,
  resolveDuplicateGroupFn,
  type DuplicateGroupRow,
} from "@/lib/intelligence/intelligence.functions";

function money(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "No price";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(value);
}

function GroupCard({
  group,
  verified,
  onAction,
  busy,
}: {
  group: DuplicateGroupRow;
  verified: boolean;
  onAction: (groupId: string, action: "keep_separate" | "merge" | "reevaluate") => void;
  busy: boolean;
}) {
  return (
    <div className="rounded-lg border border-border/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={verified ? "default" : "secondary"}>
            {verified ? "Verified identical" : "Suspect"}
          </Badge>
          <span className="text-xs text-muted-foreground">
            Confidence {Math.round(group.confidence * 100)}%
          </span>
          {group.price_spread ? (
            <span className="text-xs text-muted-foreground">
              Price difference {money(group.price_spread)}
            </span>
          ) : null}
          {group.admin_decision ? (
            <span className="text-xs text-muted-foreground">
              Manual decision: {group.admin_decision.replace("_", " ")}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {verified ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => onAction(group.id, "keep_separate")}
            >
              Keep separate
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onAction(group.id, "merge")}>
              Merge and suppress
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => onAction(group.id, "reevaluate")}
          >
            Re-evaluate
          </Button>
        </div>
      </div>

      {group.evidence.length > 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">Evidence: {group.evidence.join(", ")}</p>
      ) : null}

      <ul className="mt-3 space-y-2">
        {group.members.map((member) => (
          <li
            key={member.product_id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2"
          >
            <span className="text-sm font-medium text-foreground">
              {member.title}
              {member.role === "canonical" ? (
                <Badge className="ml-2" variant="outline">
                  Shown to customers
                </Badge>
              ) : member.suppressed ? (
                <Badge className="ml-2" variant="secondary">
                  Hidden
                </Badge>
              ) : null}
            </span>
            <span className="text-xs text-muted-foreground">
              {money(member.price)} · {member.available === false ? "Unavailable" : "Available"}
              {member.match_score !== null ? ` · match ${Math.round(member.match_score * 100)}%` : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Product identity monitoring. High confidence matches are resolved
 * automatically, so these controls exist only for exceptions.
 */
export function DuplicateIntelligence() {
  const queryClient = useQueryClient();
  const overviewFn = useServerFn(getDuplicateOverviewFn);
  const overview = useQuery({
    queryKey: ["duplicate-intelligence"],
    queryFn: () => overviewFn({}),
    retry: false,
    refetchInterval: 60_000,
  });

  const resolveFn = useServerFn(resolveDuplicateGroupFn);
  const resolve = useMutation({
    mutationFn: (input: { groupId: string; action: "keep_separate" | "merge" | "reevaluate" }) =>
      resolveFn({ data: input }),
    onSuccess: (result) => {
      toast.success(result.message);
      void queryClient.invalidateQueries({ queryKey: ["duplicate-intelligence"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "That action failed."),
  });

  const data = overview.data;
  const act = (groupId: string, action: "keep_separate" | "merge" | "reevaluate") =>
    resolve.mutate({ groupId, action });

  return (
    <SectionCard
      title="Product identity and duplicates"
      description="Identical listings are presented once, with the cheapest purchasable listing shown to customers. Supplier records are never changed."
    >
      {overview.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading identity state.</p>
      ) : !data ? (
        <p className="text-sm text-muted-foreground">Identity state is unavailable at the moment.</p>
      ) : (
        <div className="space-y-5">
          <MetricGrid
            items={[
              { label: "Verified groups", value: data.totals.verified_groups },
              { label: "Listings hidden", value: data.totals.suppressed_listings },
              { label: "Suspects for review", value: data.totals.suspect_groups },
              { label: "Price spread found", value: money(data.totals.saved_total) },
            ]}
          />

          {data.verified.length === 0 && data.suspects.length === 0 ? (
            <EmptyState
              icon={Copy}
              title="No duplicate listings found"
              description="Groups appear here once two listings are matched on identifiers, variants and specifications."
            />
          ) : (
            <div className="space-y-3">
              {data.verified.map((group) => (
                <GroupCard
                  key={group.id}
                  group={group}
                  verified
                  onAction={act}
                  busy={resolve.isPending}
                />
              ))}
              {data.suspects.map((group) => (
                <GroupCard
                  key={group.id}
                  group={group}
                  verified={false}
                  onAction={act}
                  busy={resolve.isPending}
                />
              ))}
            </div>
          )}

          {data.recent_changes.length > 0 ? (
            <div className="text-xs text-muted-foreground">
              <p className="mb-1 font-medium text-foreground">Recent canonical changes</p>
              <ul className="space-y-1">
                {data.recent_changes.map((change, index) => (
                  <li key={`${change.created_at}-${index}`}>
                    {new Date(change.created_at).toLocaleString()}: {change.summary}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}
