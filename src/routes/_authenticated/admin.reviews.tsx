import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { SectionCard } from "@/components/admin/SectionCard";
import { StatusPill } from "@/components/admin/StatusPill";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { listReviewPlacements, updateReviewPlacement } from "@/lib/services/operations";
import { PLACEMENT_SURFACE_LABEL } from "@/lib/types/platform";

export const Route = createFileRoute("/_authenticated/admin/reviews")({
  component: ReviewsPage,
});

function ReviewsPage() {
  const queryClient = useQueryClient();
  const placements = useQuery({ queryKey: ["review-placements"], queryFn: listReviewPlacements });

  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      updateReviewPlacement(id, patch),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["review-placements"] });
      await queryClient.invalidateQueries({ queryKey: ["onboarding"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Reviews"
        title="Publiko widget placements"
        description="Reusable placement configuration for every surface that can host review content. No Publiko API details have been assumed. Add the widget reference and embed details once Publiko supplies them."
      />

      <SectionCard
        title="Connection"
        description="Publiko is not connected. Credentials and embed details are stored server side once provided."
      >
        <StatusPill tone="warning">Awaiting Publiko account details</StatusPill>
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        {(placements.data ?? []).map((placement) => (
          <SectionCard
            key={placement.id}
            title={PLACEMENT_SURFACE_LABEL[placement.surface]}
            description={placement.description ?? undefined}
            actions={
              <div className="flex items-center gap-2">
                <Label htmlFor={`enabled-${placement.id}`} className="text-xs">
                  Enabled
                </Label>
                <Switch
                  id={`enabled-${placement.id}`}
                  checked={placement.enabled}
                  onCheckedChange={(checked) =>
                    update.mutate({ id: placement.id, patch: { enabled: checked } })
                  }
                />
              </div>
            }
          >
            <div className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor={`ref-${placement.id}`}>Widget reference</Label>
                <Input
                  id={`ref-${placement.id}`}
                  defaultValue={placement.widget_reference ?? ""}
                  placeholder="Provided by Publiko"
                  onBlur={(e) =>
                    update.mutate({
                      id: placement.id,
                      patch: { widget_reference: e.target.value || null },
                    })
                  }
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Placement key: <code className="font-mono">{placement.placement_key}</code>
              </p>
            </div>
          </SectionCard>
        ))}
      </div>
    </div>
  );
}
