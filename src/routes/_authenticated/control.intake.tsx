import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { SectionCard } from "@/components/admin/SectionCard";
import { EmptyState } from "@/components/admin/EmptyState";
import { StatusPill } from "@/components/admin/StatusPill";
import { MetricGrid } from "@/components/admin/IntelligencePanels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getIntakeOverview,
  registerIntakeWebhookSubscriptions,
  retryIntakeRecord,
  updateIntakePolicy,
} from "@/lib/intake/intake.functions";
import {
  INTAKE_POLICY_LABEL,
  INTAKE_STATE_LABEL,
  type IntakePolicy,
  type IntakeState,
} from "@/lib/intake/types";

export const Route = createFileRoute("/_authenticated/control/intake")({
  component: IntakePage,
});

const FILTERS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All" },
  { value: "detected", label: "New" },
  { value: "validating", label: "Processing" },
  { value: "approved", label: "Approved" },
  { value: "published_to_storefront", label: "Live" },
  { value: "quarantined", label: "Quarantined" },
  { value: "rejected", label: "Rejected" },
  { value: "failed", label: "Failed" },
];

function stateTone(state: IntakeState) {
  switch (state) {
    case "published_to_storefront":
    case "approved":
      return "positive" as const;
    case "quarantined":
      return "warning" as const;
    case "failed":
    case "rejected":
      return "danger" as const;
    case "detected":
      return "neutral" as const;
    default:
      return "pending" as const;
  }
}

function IntakePage() {
  const queryClient = useQueryClient();
  const [state, setState] = useState("all");
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");

  const overviewFn = useServerFn(getIntakeOverview);
  const overview = useQuery({
    queryKey: ["product-intake", state, term],
    queryFn: () => overviewFn({ data: { state, search: term } }),
    retry: false,
    refetchInterval: 30_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["product-intake"] });

  const policyFn = useServerFn(updateIntakePolicy);
  const policyMutation = useMutation({
    mutationFn: (input: { key: string; value: boolean }) => policyFn({ data: input }),
    onSuccess: () => {
      toast.success("Intake policy updated.");
      void invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "The policy could not be updated"),
  });

  const retryFn = useServerFn(retryIntakeRecord);
  const retry = useMutation({
    mutationFn: (intakeId: string) => retryFn({ data: { intakeId } }),
    onSuccess: () => {
      toast.success("Queued for reprocessing.");
      void invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "That product could not be reprocessed"),
  });

  const registerFn = useServerFn(registerIntakeWebhookSubscriptions);
  const register = useMutation({
    mutationFn: () => registerFn({}),
    onSuccess: (result) => {
      if (result.error) toast.error(result.error);
      else toast.success(`Listening for ${result.registered.length} store product events.`);
      void invalidate();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : "Event subscriptions could not be set up",
      ),
  });

  const counters = overview.data?.counters;
  const policy = overview.data?.policy;
  const webhook = overview.data?.webhook;
  const records = overview.data?.records ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Product Intake"
        eyebrow="Automation"
        description="Every product that arrives from the supplier is validated, de-duplicated, classified and optimised before customers can see it."
      />

      <MetricGrid
        items={[
          { label: "New", value: counters?.detected ?? 0, hint: "Detected and waiting" },
          { label: "Processing", value: counters?.processing ?? 0 },
          { label: "Approved", value: counters?.approved ?? 0 },
          { label: "Live", value: counters?.published ?? 0, hint: "Visible in the catalogue" },
          { label: "Quarantined", value: counters?.quarantined ?? 0, hint: "Held back on quality" },
          { label: "Rejected", value: counters?.rejected ?? 0 },
          { label: "Failed", value: counters?.failed ?? 0 },
          { label: "Duplicates suppressed", value: counters?.duplicates_suppressed ?? 0 },
          { label: "Category corrections", value: counters?.category_corrections ?? 0 },
          { label: "Search intelligence", value: counters?.seo_completed ?? 0 },
        ]}
      />

      <SectionCard
        title="Store event connection"
        description="Product created and product updated events start intake immediately. The scheduled delta sync stays on as a fallback."
      >
        {webhook ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill
                tone={webhook.missing.length === 0 && webhook.supported ? "positive" : "warning"}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                {webhook.supported
                  ? webhook.missing.length === 0
                    ? "Listening for product events"
                    : `${webhook.missing.length} event types still to connect`
                  : "Store credentials are not ready"}
              </StatusPill>
              {webhook.registered.map((topic) => (
                <StatusPill key={topic} tone="neutral">
                  {topic.replace(/_/g, " ").toLowerCase()}
                </StatusPill>
              ))}
            </div>
            <p className="break-all text-xs text-muted-foreground">
              Callback endpoint: {webhook.callbackUrl}
            </p>
            {webhook.error ? <p className="text-xs text-destructive">{webhook.error}</p> : null}
            <Button
              size="sm"
              onClick={() => register.mutate()}
              disabled={register.isPending || !webhook.supported}
            >
              <RefreshCw className={register.isPending ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              Connect product events
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Checking the store connection.</p>
        )}
      </SectionCard>

      <SectionCard
        title="Intake policy"
        description="Gates every new product must clear. Passing products go live without anyone approving them by hand."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {policy
            ? (Object.keys(policy) as (keyof IntakePolicy)[]).map((key) => (
                <label
                  key={key}
                  className="flex items-center justify-between gap-4 rounded-xl border border-border/70 bg-card p-3"
                >
                  <span className="text-sm text-foreground">{INTAKE_POLICY_LABEL[key]}</span>
                  <Switch
                    checked={policy[key]}
                    disabled={policyMutation.isPending}
                    onCheckedChange={(value) => policyMutation.mutate({ key, value })}
                  />
                </label>
              ))
            : null}
        </div>
      </SectionCard>

      <SectionCard
        title="Recent intake records"
        description="Detection source, current stage and the reason a product is where it is."
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {FILTERS.map((filter) => (
            <Button
              key={filter.value}
              size="sm"
              variant={state === filter.value ? "default" : "outline"}
              onClick={() => setState(filter.value)}
            >
              {filter.label}
            </Button>
          ))}
          <form
            className="ml-auto flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setTerm(search.trim());
            }}
          >
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search title, handle or store id"
              className="h-9 w-56"
            />
            <Button size="sm" type="submit" variant="outline">
              Search
            </Button>
          </form>
        </div>

        {records.length === 0 ? (
          <EmptyState
            title="No intake records match"
            description="New products appear here as soon as the store reports them."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="max-w-[22rem]">
                      <div className="truncate font-medium text-foreground">
                        {record.title ?? "Untitled product"}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {record.shopify_product_id.replace("gid://shopify/Product/", "Store id ")}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {record.source.replace(/_/g, " ")}
                      <div>{new Date(record.detected_at).toLocaleString("en-GB")}</div>
                    </TableCell>
                    <TableCell>
                      <StatusPill tone={stateTone(record.state)}>
                        {INTAKE_STATE_LABEL[record.state]}
                      </StatusPill>
                    </TableCell>
                    <TableCell className="max-w-[20rem] text-xs text-muted-foreground">
                      {record.reason ?? "No reason recorded"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(record.last_transition_at).toLocaleString("en-GB")}
                    </TableCell>
                    <TableCell className="text-right">
                      {["quarantined", "failed", "rejected"].includes(record.state) ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={retry.isPending}
                          onClick={() => retry.mutate(record.id)}
                        >
                          Reprocess
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
