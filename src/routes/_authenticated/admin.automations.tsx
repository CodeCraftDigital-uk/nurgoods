import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Play, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { SectionCard } from "@/components/admin/SectionCard";
import { EmptyState } from "@/components/admin/EmptyState";
import { StatusPill, statusTone, humanise } from "@/components/admin/StatusPill";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  listAiRuns,
  listAutomationJobs,
  listPromptVersions,
  setAutomationEnabled,
} from "@/lib/services/operations";
import { getAiProviderStatus } from "@/lib/ai/ai-config.functions";
import { getAutomationReadiness, runAutomation } from "@/lib/automation/automation.functions";
import { WORKFLOW_PIPELINE } from "@/lib/ai/workflow";
import type { AutomationJob } from "@/lib/types/platform";

export const Route = createFileRoute("/_authenticated/admin/automations")({
  component: AutomationsPage,
});

function AutomationsPage() {
  const queryClient = useQueryClient();
  const aiStatusFn = useServerFn(getAiProviderStatus);
  const readinessFn = useServerFn(getAutomationReadiness);
  const runJobFn = useServerFn(runAutomation);

  const aiStatus = useQuery({
    queryKey: ["ai-status"],
    queryFn: () => aiStatusFn({}),
    retry: false,
  });
  const readiness = useQuery({
    queryKey: ["automation-readiness"],
    queryFn: () => readinessFn({}),
    retry: false,
  });
  const jobs = useQuery({ queryKey: ["automation-jobs"], queryFn: listAutomationJobs });
  const runs = useQuery({ queryKey: ["ai-runs"], queryFn: () => listAiRuns(10) });
  const prompts = useQuery({ queryKey: ["prompt-versions"], queryFn: listPromptVersions });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      setAutomationEnabled(id, enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["automation-jobs"] }),
    onError: (error: Error) => toast.error(error.message),
  });

  const runJob = useMutation({
    mutationFn: (jobKey: string) => runJobFn({ data: { jobKey } }),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["automation-jobs"] }),
        queryClient.invalidateQueries({ queryKey: ["ai-runs"] }),
        queryClient.invalidateQueries({ queryKey: ["seo-records"] }),
        queryClient.invalidateQueries({ queryKey: ["briefs"] }),
        queryClient.invalidateQueries({ queryKey: ["articles"] }),
        queryClient.invalidateQueries({ queryKey: ["onboarding"] }),
      ]);
      if (result.status === "skipped") toast.info(result.message);
      else toast.success(result.message);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const configured = aiStatus.data?.configured ?? false;

  const blockedReason = (job: AutomationJob): string | null => {
    if (!readiness.data) return null;
    if (job.requires_integration === "shopify" && !readiness.data.shopify) {
      return "Waiting on store credentials";
    }
    if (job.requires_integration === "ai_provider" && !readiness.data.managedAi) {
      return "Managed AI is unavailable right now";
    }
    return null;
  };

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Automations"
        title="Content and sync automation"
        description="Jobs, prompt versions and generation runs. Every job can be run on demand and records its real outcome. Publishing and factual claims always stay under editor control."
      />

      <SectionCard
        title="Editorial AI"
        description="Runs on the managed platform service. No owner supplied model keys are needed and nothing model related reaches the browser."
      >
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill tone={configured ? "positive" : "warning"}>
            {configured ? "Active" : "Unavailable"}
          </StatusPill>
          {configured ? (
            <span className="text-sm text-muted-foreground">
              {aiStatus.data?.providerId} · {aiStatus.data?.model}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">
              Managed AI is temporarily unavailable. Editorial stages resume automatically.
            </span>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="Jobs"
        description="Enable a job to include it in scheduled operation, or run it now to see the result immediately."
      >
        {jobs.isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((row) => (
              <div key={row} className="h-20 animate-pulse rounded-lg bg-muted/60" />
            ))}
          </div>
        ) : jobs.isError ? (
          <EmptyState
            icon={Sparkles}
            title="Jobs could not be loaded"
            description="The connection to the platform database failed. Retry in a moment."
            action={
              <Button variant="outline" className="min-h-11" onClick={() => jobs.refetch()}>
                Retry
              </Button>
            }
          />
        ) : (jobs.data ?? []).length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="No jobs configured"
            description="Automation jobs appear here once the platform operations catalogue is in place."
          />
        ) : (
          <ul className="space-y-3">
            {(jobs.data ?? []).map((job) => {
              const blocked = blockedReason(job);
              const running = runJob.isPending && runJob.variables === job.job_key;
              const lastResult = (job.last_result ?? {}) as { message?: string };
              return (
                <li key={job.id} className="rounded-xl border border-border/70 p-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-foreground">{job.label}</p>
                        {job.last_status ? (
                          <StatusPill tone={statusTone(job.last_status)}>
                            {humanise(job.last_status)}
                          </StatusPill>
                        ) : (
                          <StatusPill tone="neutral">Never run</StatusPill>
                        )}
                        {blocked ? <StatusPill tone="warning">{blocked}</StatusPill> : null}
                      </div>
                      <p className="mt-1.5 text-sm text-muted-foreground">{job.description}</p>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {job.requires_integration
                          ? `Depends on ${humanise(job.requires_integration)}`
                          : "No external dependency"}
                        {job.last_run_at
                          ? ` · Last run ${new Date(job.last_run_at).toLocaleString()}`
                          : " · Not run yet"}
                      </p>
                      {lastResult.message ? (
                        <p className="mt-2 rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
                          {lastResult.message}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 sm:flex-col sm:items-end">
                      <Button
                        variant="outline"
                        className="min-h-11"
                        disabled={running}
                        onClick={() => runJob.mutate(job.job_key)}
                      >
                        {running ? (
                          <Loader2 className="mr-2 size-4 animate-spin" />
                        ) : (
                          <Play className="mr-2 size-4" />
                        )}
                        Run now
                      </Button>
                      <div className="flex items-center gap-2">
                        <Label htmlFor={`job-${job.id}`} className="text-xs">
                          Enabled
                        </Label>
                        <Switch
                          id={`job-${job.id}`}
                          checked={job.enabled}
                          onCheckedChange={(checked) =>
                            toggle.mutate({ id: job.id, enabled: checked })
                          }
                        />
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
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
          {runs.isLoading ? (
            <div className="h-24 animate-pulse rounded-lg bg-muted/60" />
          ) : (runs.data ?? []).length === 0 ? (
            <EmptyState
              icon={Sparkles}
              title="No runs yet"
              description="Runs appear once a workflow stage or an automation job executes."
            />
          ) : (
            <ul className="divide-y divide-border">
              {(runs.data ?? []).map((run) => (
                <li key={run.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">{humanise(run.stage)}</p>
                    <p className="truncate text-xs text-muted-foreground">
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
