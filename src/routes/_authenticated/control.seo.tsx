import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, RefreshCw, Search, Sparkles, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/admin/PageHeader";
import { MetricGrid, ProgressBar } from "@/components/admin/IntelligencePanels";
import { getSeoIntelligenceFn } from "@/lib/intelligence/intelligence.functions";
import { SectionCard } from "@/components/admin/SectionCard";
import { EmptyState } from "@/components/admin/EmptyState";
import { StatusPill, statusTone, humanise } from "@/components/admin/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addSeoQuestion,
  createSeoEntity,
  createSeoRecord,
  deleteSeoQuestion,
  listSeoEntities,
  listSeoQuestions,
  listSeoRecords,
  updateSeoQuestion,
  updateSeoRecord,
} from "@/lib/services/seo";
import { runSeoRecordPlan, syncSeoCoverageRecords } from "@/lib/ai/seo.functions";
import {
  OPTIMISATION_STATUS_LABEL,
  type OptimisationStatus,
  type SeoTargetType,
} from "@/lib/types/platform";

export const Route = createFileRoute("/_authenticated/control/seo")({
  component: SeoPage,
});

const TARGET_TYPES: SeoTargetType[] = ["product", "collection", "article", "page"];
const STATUSES = Object.keys(OPTIMISATION_STATUS_LABEL) as OptimisationStatus[];

function SeoPage() {
  const queryClient = useQueryClient();
  const records = useQuery({ queryKey: ["seo-records"], queryFn: listSeoRecords });
  const entities = useQuery({ queryKey: ["seo-entities"], queryFn: listSeoEntities });

  const syncCoverage = useServerFn(syncSeoCoverageRecords);
  const runPlan = useServerFn(runSeoRecordPlan);

  const [targetType, setTargetType] = useState<SeoTargetType>("product");
  const [reference, setReference] = useState("");
  const [query, setQuery] = useState("");
  const [entityName, setEntityName] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = (records.data ?? []).find((record) => record.id === selectedId) ?? null;

  const addRecord = useMutation({
    mutationFn: () =>
      createSeoRecord({
        targetType,
        targetReference: reference.trim(),
        targetQuery: query.trim() || null,
      }),
    onSuccess: async () => {
      setReference("");
      setQuery("");
      await queryClient.invalidateQueries({ queryKey: ["seo-records"] });
      toast.success("SEO record created");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const addEntity = useMutation({
    mutationFn: () => createSeoEntity({ name: entityName.trim() }),
    onSuccess: async () => {
      setEntityName("");
      await queryClient.invalidateQueries({ queryKey: ["seo-entities"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: OptimisationStatus }) =>
      updateSeoRecord(id, {
        optimisation_status: status,
        last_reviewed_at: status === "optimised" ? new Date().toISOString() : null,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["seo-records"] }),
    onError: (error: Error) => toast.error(error.message),
  });

  const coverage = useMutation({
    mutationFn: () => syncCoverage({ data: undefined }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["seo-records"] });
      if (result.skipped) {
        toast.info(result.skipped.reason);
        return;
      }
      toast.success(
        result.created > 0
          ? `${result.created} new record${result.created === 1 ? "" : "s"} added, ${result.existing} already covered`
          : `Coverage is already complete across ${result.existing} items`,
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const plan = useMutation({
    mutationFn: (recordId: string) => runPlan({ data: { recordId } }),
    onSuccess: async (result, recordId) => {
      await queryClient.invalidateQueries({ queryKey: ["seo-records"] });
      await queryClient.invalidateQueries({ queryKey: ["seo-questions", recordId] });
      setSelectedId(recordId);
      toast.success(
        `Draft plan ready for review. ${result.applied.length} field${result.applied.length === 1 ? "" : "s"} updated, ${result.questionsAdded} question${result.questionsAdded === 1 ? "" : "s"} added.`,
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const summary = summarise(records.data ?? []);

  return (
    <div className="space-y-8">
      <ProductSeoHealth />
      <PageHeader
        eyebrow="SEO Intelligence"
        title="Query, entity and metadata coverage"
        description="Track target query, search intent, entities, answerable questions, internal link targets, title, meta description, canonical, schema type and optimisation status for every product, collection, article and page."
        actions={
          <Button
            onClick={() => coverage.mutate()}
            disabled={coverage.isPending}
            className="min-h-11 w-full sm:w-auto"
          >
            {coverage.isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 size-4" />
            )}
            Sync coverage
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: "Records", value: summary.total },
          { label: "Not started", value: summary.not_started },
          { label: "Needs review", value: summary.needs_review },
          { label: "Optimised", value: summary.optimised },
        ].map((tile) => (
          <div key={tile.label} className="rounded-xl border border-border/70 p-4">
            <p className="text-[0.7rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {tile.label}
            </p>
            <p className="mt-1.5 font-display text-2xl text-foreground">{tile.value}</p>
          </div>
        ))}
      </div>

      <SectionCard
        title="Records"
        description="Coverage is generated from real Journal and catalogue rows. Drafted plans always land as needs review so a person confirms the wording."
      >
        {records.isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((row) => (
              <div key={row} className="h-16 animate-pulse rounded-lg bg-muted/60" />
            ))}
          </div>
        ) : records.isError ? (
          <EmptyState
            icon={Search}
            title="Records could not be loaded"
            description="The connection to the platform database failed. Retry in a moment."
            action={
              <Button variant="outline" onClick={() => records.refetch()} className="min-h-11">
                Retry
              </Button>
            }
          />
        ) : (records.data ?? []).length === 0 ? (
          <EmptyState
            icon={Search}
            title="No SEO records yet"
            description="Run coverage sync to create a record for every Journal article and every synced product and collection, or add one by hand below."
            action={
              <Button
                onClick={() => coverage.mutate()}
                disabled={coverage.isPending}
                className="min-h-11"
              >
                Sync coverage
              </Button>
            }
          />
        ) : (
          <ul className="space-y-3">
            {(records.data ?? []).map((record) => {
              const isOpen = record.id === selectedId;
              return (
                <li key={record.id} className="rounded-xl border border-border/70">
                  <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => setSelectedId(isOpen ? null : record.id)}
                      aria-expanded={isOpen}
                    >
                      <p className="truncate font-medium text-foreground">
                        {record.target_label ?? record.target_reference}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {humanise(record.target_type)} - {record.target_query ?? "No query set"}
                      </p>
                    </button>
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill tone={statusTone(record.optimisation_status)}>
                        {OPTIMISATION_STATUS_LABEL[record.optimisation_status]}
                      </StatusPill>
                      <Button
                        variant="outline"
                        className="min-h-11"
                        onClick={() => plan.mutate(record.id)}
                        disabled={plan.isPending}
                      >
                        {plan.isPending && plan.variables === record.id ? (
                          <Loader2 className="mr-2 size-4 animate-spin" />
                        ) : (
                          <Sparkles className="mr-2 size-4" />
                        )}
                        Draft plan
                      </Button>
                    </div>
                  </div>

                  {isOpen ? (
                    <div className="space-y-4 border-t border-border/70 p-4">
                      <dl className="grid gap-3 sm:grid-cols-2">
                        <Field label="Search intent" value={record.search_intent} />
                        <Field label="Schema type" value={record.schema_type} />
                        <Field label="Meta title" value={record.meta_title} />
                        <Field label="Meta description" value={record.meta_description} />
                      </dl>

                      {(record.secondary_queries ?? []).length > 0 ? (
                        <div>
                          <p className="text-[0.7rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                            Secondary queries
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {record.secondary_queries.map((item) => (
                              <StatusPill key={item} tone={statusTone(null)}>
                                {item}
                              </StatusPill>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <QuestionsPanel recordId={record.id} />

                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <Label className="text-xs text-muted-foreground sm:w-40">
                          Optimisation status
                        </Label>
                        <Select
                          value={record.optimisation_status}
                          onValueChange={(v) =>
                            setStatus.mutate({ id: record.id, status: v as OptimisationStatus })
                          }
                        >
                          <SelectTrigger className="min-h-11 sm:w-56">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {STATUSES.map((status) => (
                              <SelectItem key={status} value={status}>
                                {OPTIMISATION_STATUS_LABEL[status]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Add a record by hand">
        <form
          className="grid gap-3 sm:grid-cols-[1fr_1.5fr_1.5fr_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            if (!reference.trim()) {
              toast.error("Add a target reference");
              return;
            }
            addRecord.mutate();
          }}
        >
          <div className="space-y-2">
            <Label>Target type</Label>
            <Select value={targetType} onValueChange={(v) => setTargetType(v as SeoTargetType)}>
              <SelectTrigger className="min-h-11">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TARGET_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {humanise(type)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="reference">Target reference</Label>
            <Input
              id="reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Handle, slug or path"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="query">Target query</Label>
            <Input
              id="query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Primary query"
            />
          </div>
          <div className="flex items-end">
            <Button
              type="submit"
              disabled={addRecord.isPending}
              className="min-h-11 w-full sm:w-auto"
            >
              Add
            </Button>
          </div>
        </form>
      </SectionCard>

      <SectionCard
        title="Entities"
        description="Named entities that give answer engines clarity about what the content covers."
      >
        <form
          className="flex flex-col gap-3 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!entityName.trim()) return;
            addEntity.mutate();
          }}
        >
          <Input
            value={entityName}
            onChange={(e) => setEntityName(e.target.value)}
            placeholder="Entity name"
          />
          <Button type="submit" disabled={addEntity.isPending} className="min-h-11">
            Add entity
          </Button>
        </form>
        <div className="mt-4 flex flex-wrap gap-2">
          {(entities.data ?? []).map((entity) => (
            <StatusPill key={entity.id} tone={statusTone(null)}>
              {entity.name}
            </StatusPill>
          ))}
          {(entities.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No entities recorded yet.</p>
          ) : null}
        </div>
      </SectionCard>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-[0.7rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-foreground">{value ?? "Not set"}</dd>
    </div>
  );
}

function QuestionsPanel({ recordId }: { recordId: string }) {
  const queryClient = useQueryClient();
  const questions = useQuery({
    queryKey: ["seo-questions", recordId],
    queryFn: () => listSeoQuestions(recordId),
  });
  const [draft, setDraft] = useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["seo-questions", recordId] });

  const add = useMutation({
    mutationFn: () => addSeoQuestion({ recordId, question: draft.trim() }),
    onSuccess: async () => {
      setDraft("");
      await invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggle = useMutation({
    mutationFn: ({ id, include }: { id: string; include: boolean }) =>
      updateSeoQuestion(id, { include_in_faq_schema: include }),
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteSeoQuestion(id),
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div>
      <p className="text-[0.7rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Answerable questions
      </p>
      {questions.isLoading ? (
        <div className="mt-2 h-10 animate-pulse rounded-lg bg-muted/60" />
      ) : (questions.data ?? []).length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No questions recorded yet. Draft a plan or add one below.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {(questions.data ?? []).map((item) => (
            <li key={item.id} className="rounded-lg border border-border/70 p-3">
              <p className="text-sm font-medium text-foreground">{item.question}</p>
              {item.answer ? (
                <p className="mt-1 text-sm text-muted-foreground">{item.answer}</p>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Switch
                    checked={item.include_in_faq_schema}
                    onCheckedChange={(value) => toggle.mutate({ id: item.id, include: value })}
                  />
                  Approved for FAQ structured data
                </label>
                <Button
                  variant="ghost"
                  className="min-h-11 text-muted-foreground"
                  onClick={() => remove.mutate(item.id)}
                >
                  <Trash2 className="mr-2 size-4" />
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form
        className="mt-3 flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          add.mutate();
        }}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a question a shopper would ask"
        />
        <Button type="submit" variant="outline" disabled={add.isPending} className="min-h-11">
          Add question
        </Button>
      </form>
    </div>
  );
}

function summarise(records: Array<{ optimisation_status: OptimisationStatus }>) {
  return {
    total: records.length,
    not_started: records.filter((r) => r.optimisation_status === "not_started").length,
    needs_review: records.filter((r) => r.optimisation_status === "needs_review").length,
    optimised: records.filter((r) => r.optimisation_status === "optimised").length,
  };
}

/**
 * Automated product search intelligence. This is a monitoring surface: every
 * figure here comes from work the pipeline has already validated and published.
 */
function ProductSeoHealth() {
  const fetchOverview = useServerFn(getSeoIntelligenceFn);
  const overview = useQuery({
    queryKey: ["seo-intelligence"],
    queryFn: () => fetchOverview({}),
    retry: false,
    refetchInterval: 30_000,
  });
  const data = overview.data;

  return (
    <SectionCard
      title="Automatic product optimisation"
      description="Titles, meta descriptions, entities, alt text, structured data inputs and internal links are generated and validated automatically for every synced product. Nothing waits on approval."
    >
      {overview.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading optimisation state.</p>
      ) : !data ? (
        <p className="text-sm text-muted-foreground">
          Optimisation state is unavailable right now.
        </p>
      ) : (
        <div className="space-y-5">
          <MetricGrid
            items={[
              { label: "Optimisation health", value: `${data.totals.healthPercent}%` },
              { label: "Optimised", value: `${data.totals.optimised} / ${data.totals.products}` },
              { label: "Valid schema", value: `${data.totals.validSchemaPercent}%` },
              { label: "Average score", value: data.totals.averageScore },
              { label: "Needs attention", value: data.totals.needsAttention },
              { label: "Rejected", value: data.totals.rejected },
              { label: "Duplicate metadata", value: data.totals.duplicateMetadata },
              { label: "Missing metadata", value: data.totals.missingMetadata },
            ]}
          />
          <ProgressBar percent={data.backfill.percent} label="Backfill progress" />
          {data.issues.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {data.issues.map((issue) => (
                <li
                  key={issue.code}
                  className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground"
                >
                  {issue.label} ({issue.count})
                </li>
              ))}
            </ul>
          ) : null}
          {data.recent.length > 0 ? (
            <ul className="divide-y divide-border">
              {data.recent.map((row) => (
                <li key={row.product_id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">{row.seo_title ?? row.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.handle} scored {row.optimisation_score}
                    </p>
                  </div>
                  <StatusPill tone={statusTone(row.validation_state)}>
                    {humanise(row.validation_state)}
                  </StatusPill>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-xs text-muted-foreground">
            {data.lastRun.at
              ? `Last automatic run ${new Date(data.lastRun.at).toLocaleString()}.`
              : "No automatic run has completed yet."}
          </p>
        </div>
      )}
    </SectionCard>
  );
}
