import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { SectionCard } from "@/components/admin/SectionCard";
import { EmptyState } from "@/components/admin/EmptyState";
import { StatusPill, statusTone, humanise } from "@/components/admin/StatusPill";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  listAiRuns,
  listAutomationJobs,
  listPromptVersions,
  setAutomationEnabled,
} from "@/lib/services/operations";
import { getAiProviderStatus } from "@/lib/ai/ai-config.functions";
import { WORKFLOW_PIPELINE } from "@/lib/ai/workflow";

export const Route = createFileRoute("/_authenticated/admin/automations")({
  component: AutomationsPage,
});

function AutomationsPage() {
  const queryClient = useQueryClient();
  const aiStatusFn = useServerFn(getAiProviderStatus);
  const aiStatus = useQuery({
    queryKey: ["ai-status"],
    queryFn: () => aiStatusFn({}),
    retry: false,
  });
  const jobs = useQuery({ queryKey: ["automation-jobs"], queryFn: listAutomationJobs });
  const runs = useQuery({ queryKey: ["ai-runs"], queryFn: () => listAiRuns(10) });
  const prompts = useQuery({ queryKey: ["prompt-versions"], queryFn: listPromptVersions });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      setAutomationEnabled(id, enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["automation-jobs"] }),
  });

  const configured = aiStatus.data?.configured ?? false;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Automations"
        title="Content and sync automation"
        description="Scheduled jobs, prompt versions and generation runs. Jobs stay disabled until the integration they depend on is connected."
      />

      <SectionCard
        title="AI provider"
        description="Provider agnostic. Credentials live in server side secrets and are never exposed to the browser."
      >
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill tone={configured ? "positive" : "warning"}>
            {configured ? "Configured" : "Not configured"}
          </StatusPill>
          {configured ? (
            <span className="text-sm text-muted-foreground">
              {aiStatus.data?.providerId} · {aiStatus.data?.model}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">
              Managed AI is temporarily unavailable. Editorial stages will resume automatically.
            </span>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Scheduled jobs">
        <ul className="divide-y divide-border">
          {(jobs.data ?? []).map((job) => (
            <li key={job.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">{job.label}</p>
                <p className="mt-1 text-sm text-muted-foreground">{job.description}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {job.requires_integration
                    ? `Requires the ${job.requires_integration} integration`
                    : "No external integration required"}
                  {job.last_run_at
                    ? ` · Last run ${new Date(job.last_run_at).toLocaleString()}`
                    : " · Never run"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor={`job-${job.id}`} className="text-xs">
                  Enabled
                </Label>
                <Switch
                  id={`job-${job.id}`}
                  checked={job.enabled}
                  onCheckedChange={(checked) => toggle.mutate({ id: job.id, enabled: checked })}
                />
              </div>
            </li>
          ))}
        </ul>
      </SectionCard>

      <SectionCard
        title="Workflow stages"
        description="Each stage records its prompt version, provider, model, inputs, outputs and sources for full provenance."
      >
        <ol className="grid gap-3 sm:grid-cols-2">
          {WORKFLOW_PIPELINE.map((stage) => (
            <li key={stage.stage} className="rounded-lg border border-border p-4">
              <p className="text-sm font-medium text-foreground">{stage.label}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{stage.summary}</p>
              <p className="mt-2 text-[0.7rem] uppercase tracking-[0.14em] text-muted-foreground">
                {stage.outputs.join(" · ")}
              </p>
            </li>
          ))}
        </ol>
      </SectionCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Recent generation runs">
          {(runs.data ?? []).length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title="No runs yet"
              description="Runs appear once an AI provider is connected and a workflow stage executes."
            />
          ) : (
            <ul className="divide-y divide-border">
              {(runs.data ?? []).map((run) => (
                <li key={run.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="text-sm text-foreground">{humanise(run.stage)}</p>
                    <p className="text-xs text-muted-foreground">
                      {run.provider ?? "Unknown provider"} ·{" "}
                      {new Date(run.created_at).toLocaleString()}
                    </p>
                  </div>
                  <StatusPill tone={statusTone(run.status)}>{humanise(run.status)}</StatusPill>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Prompt versions"
          description="Every run stores the prompt version used so output can be traced."
        >
          {(prompts.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No prompt versions stored yet. They are created with the first generation stage.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {(prompts.data ?? []).map((prompt) => (
                <li key={prompt.id} className="flex items-center justify-between py-3">
                  <span className="text-sm text-foreground">{prompt.label}</span>
                  <StatusPill tone="neutral">v{prompt.version}</StatusPill>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
