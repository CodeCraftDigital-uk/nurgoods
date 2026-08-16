import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { SectionCard } from "@/components/admin/SectionCard";
import { StatusPill } from "@/components/admin/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  createReviewPlacement,
  deleteReviewPlacement,
  listReviewPlacements,
  updateReviewPlacement,
} from "@/lib/services/operations";
import { PUBLIKO_PLACEMENTS, embedOrigins, looksLikeEmbedCode, toPlacementKey } from "@/lib/publiko";
import { PLACEMENT_SURFACE_LABEL } from "@/lib/types/platform";
import type { PlacementSurface, ReviewPlacement } from "@/lib/types/platform";

export const Route = createFileRoute("/_authenticated/control/reviews")({
  component: ReviewsAdminPage,
});

/**
 * Publiko is embed code based. Everything on this screen is operator authored
 * configuration. Embed code is never executed inside the admin, only stored,
 * so a mistaken paste cannot run script in a privileged session.
 */
function ReviewsAdminPage() {
  const queryClient = useQueryClient();
  const placements = useQuery({ queryKey: ["review-placements"], queryFn: listReviewPlacements });

  const [label, setLabel] = useState("");
  const [surface, setSurface] = useState<PlacementSurface>("reviews_page");
  const [snippet, setSnippet] = useState("");
  const [notes, setNotes] = useState("");

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["review-placements"] });
    await queryClient.invalidateQueries({ queryKey: ["onboarding"] });
  };

  const create = useMutation({
    mutationFn: () =>
      createReviewPlacement({
        label: label.trim(),
        surface,
        placementKey: toPlacementKey(label.trim(), surface),
        embedSnippet: snippet.trim(),
        notes: notes.trim() || null,
      }),
    onSuccess: async () => {
      setLabel("");
      setSnippet("");
      setNotes("");
      toast.success("Widget saved. Enable it when you are ready for it to appear.");
      await refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ReviewPlacement> }) =>
      updateReviewPlacement(id, patch),
    onSuccess: refresh,
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteReviewPlacement(id),
    onSuccess: async () => {
      toast.success("Widget removed.");
      await refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const items = placements.data ?? [];
  const canSave = label.trim().length > 1 && looksLikeEmbedCode(snippet.trim());

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Reviews"
        title="Publiko widgets"
        description="Publiko supplies widget embed code. Paste each piece of code here, give it a name, choose where it belongs, then enable it. No Publiko API key or developer integration is needed for reviews to show on the site."
      />

      <SectionCard
        title="Add a widget"
        description="Copy the embed code from your Publiko dashboard for the widget you want, then assign it to a placement."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="widget-label">Internal name</Label>
            <Input
              id="widget-label"
              value={label}
              maxLength={80}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Wall of Love"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="widget-surface">Placement</Label>
            <select
              id="widget-surface"
              value={surface}
              onChange={(event) => setSurface(event.target.value as PlacementSurface)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
            >
              {PUBLIKO_PLACEMENTS.map((item) => (
                <option key={item.surface} value={item.surface}>
                  {item.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              {PUBLIKO_PLACEMENTS.find((item) => item.surface === surface)?.description}
            </p>
          </div>
        </div>
        <div className="mt-4 space-y-2">
          <Label htmlFor="widget-snippet">Publiko embed code</Label>
          <Textarea
            id="widget-snippet"
            value={snippet}
            onChange={(event) => setSnippet(event.target.value)}
            rows={6}
            spellCheck={false}
            className="font-mono text-xs"
            placeholder="Paste the embed code exactly as Publiko supplies it"
          />
          {snippet.trim() && embedOrigins(snippet).length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Loads from: {embedOrigins(snippet).join(", ")}
            </p>
          ) : null}
        </div>
        <div className="mt-4 space-y-2">
          <Label htmlFor="widget-notes">Notes, optional</Label>
          <Input
            id="widget-notes"
            value={notes}
            maxLength={200}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Anything the team should know about this widget"
          />
        </div>
        <div className="mt-5 flex items-center gap-3">
          <Button disabled={!canSave || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? "Saving" : "Save widget"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Saved widgets stay switched off until you enable them.
          </p>
        </div>
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        {items.length === 0 && !placements.isLoading ? (
          <SectionCard title="No widgets yet" description="Add your first Publiko embed above.">
            <p className="text-sm text-muted-foreground">
              Until a widget is saved and enabled, the Reviews page shows a neutral coming soon
              message and no review content appears anywhere else on the site.
            </p>
          </SectionCard>
        ) : null}

        {items.map((placement) => {
          const configured = Boolean(placement.embed_snippet?.trim());
          return (
            <SectionCard
              key={placement.id}
              title={placement.label}
              description={PLACEMENT_SURFACE_LABEL[placement.surface]}
              actions={
                <div className="flex items-center gap-2">
                  <StatusPill
                    tone={placement.enabled && configured ? "positive" : "warning"}
                  >
                    {!configured ? "No code" : placement.enabled ? "Live" : "Off"}
                  </StatusPill>
                  <Switch
                    aria-label={`Enable ${placement.label}`}
                    checked={placement.enabled}
                    disabled={!configured}
                    onCheckedChange={(checked) =>
                      update.mutate({ id: placement.id, patch: { enabled: checked } })
                    }
                  />
                </div>
              }
            >
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor={`snippet-${placement.id}`}>Embed code</Label>
                  <Textarea
                    id={`snippet-${placement.id}`}
                    defaultValue={placement.embed_snippet ?? ""}
                    rows={5}
                    spellCheck={false}
                    className="font-mono text-xs"
                    onBlur={(event) => {
                      const value = event.target.value.trim();
                      if (value === (placement.embed_snippet ?? "")) return;
                      update.mutate({
                        id: placement.id,
                        patch: { embed_snippet: value || null },
                      });
                    }}
                  />
                </div>
                {configured ? (
                  <p className="text-xs text-muted-foreground">
                    Loads from: {embedOrigins(placement.embed_snippet ?? "").join(", ") || "no external origin"}
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Placement key <code className="font-mono">{placement.placement_key}</code>
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => remove.mutate(placement.id)}
                >
                  Remove widget
                </Button>
              </div>
            </SectionCard>
          );
        })}
      </div>
    </div>
  );
}
