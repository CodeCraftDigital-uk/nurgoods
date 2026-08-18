import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Calculator, RefreshCw, ShieldCheck, Truck } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { SectionCard } from "@/components/admin/SectionCard";
import { EmptyState } from "@/components/admin/EmptyState";
import { StatusPill } from "@/components/admin/StatusPill";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  applyPricingAuditFn,
  getPricingAudit,
  recoverSupplierLinkageFn,
  refreshShippingQuotesFn,
  runPricingAuditFn,
  syncVariantCostsFn,
} from "@/lib/pricing/pricing.functions";
import { AUDIT_STATUS_LABEL, type AuditStatus } from "@/lib/pricing/types";
import { formatMoney, formatPercent } from "@/lib/zendrop/pricing";

export const Route = createFileRoute("/_authenticated/control/pricing")({
  component: CataloguePricingPage,
});

const STATUS_TONE: Record<AuditStatus, "positive" | "warning" | "neutral" | "pending"> = {
  ready_to_reprice: "warning",
  already_correct: "positive",
  held_missing_cost: "pending",
  held_missing_uk_shipping: "pending",
  held_stale_shipping_quote: "pending",

  held_unreliable_linkage: "pending",
  excluded_by_policy: "neutral",
};

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/60 p-4 shadow-sm backdrop-blur">
      <p className="text-[0.7rem] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function CataloguePricingPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("ready_to_reprice");
  const [selected, setSelected] = useState<string[]>([]);

  const auditFn = useServerFn(getPricingAudit);
  const audit = useQuery({
    queryKey: ["pricing-audit", statusFilter],
    queryFn: () => auditFn({ data: { status: statusFilter } }),
    retry: false,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["pricing-audit"] });
    setSelected([]);
  };

  const syncFn = useServerFn(syncVariantCostsFn);
  const syncCosts = useMutation({
    mutationFn: () => syncFn({}),
    onSuccess: (result) => {
      toast.success(result.message);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const linkageFn = useServerFn(recoverSupplierLinkageFn);
  const recoverLinkage = useMutation({
    mutationFn: () => linkageFn({}),
    onSuccess: (result) => {
      toast.success(result.message);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const quotesFn = useServerFn(refreshShippingQuotesFn);
  const refreshQuotes = useMutation({
    mutationFn: () => quotesFn({ data: {} }),
    onSuccess: (result) => {
      toast.success(result.message);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const runFn = useServerFn(runPricingAuditFn);
  const runAudit = useMutation({
    mutationFn: () => runFn({}),
    onSuccess: (result) => {
      toast.success(result.message);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const applyFn = useServerFn(applyPricingAuditFn);
  const applyAudit = useMutation({
    mutationFn: (input: { runId: string; itemIds?: string[] }) => applyFn({ data: input }),
    onSuccess: (result) => {
      if (result.failures.length > 0) toast.error(result.failures[0] ?? "Some updates failed");
      else toast.success(result.message);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const run = audit.data?.run ?? null;
  const totals = run?.totals;
  const items = audit.data?.items ?? [];
  const revisions = audit.data?.revisions ?? [];
  const coverage = audit.data?.costCoverage;

  const eligibleIds = useMemo(
    () => items.filter((item) => item.status === "ready_to_reprice").map((item) => item.id),
    [items],
  );

  const heldTotal =
    (totals?.held_missing_cost ?? 0) +
    (totals?.held_missing_uk_shipping ?? 0) +
    (totals?.held_stale_shipping_quote ?? 0) +
    (totals?.held_unreliable_linkage ?? 0);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Catalogue pricing"
        title="Existing listing repricing"
        description="A dry run first. Every listing is measured against protected landed cost plus payment fees, solved back to the price that holds the target margin, then rounded up. Nothing changes in the store until an administrator applies a reviewed audit."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => syncCosts.mutate()} disabled={syncCosts.isPending}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {syncCosts.isPending ? "Reading costs" : "Refresh cost data"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => recoverLinkage.mutate()}
              disabled={recoverLinkage.isPending}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {recoverLinkage.isPending ? "Rebuilding links" : "Rebuild supplier links"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refreshQuotes.mutate()}
              disabled={refreshQuotes.isPending}
            >
              <Truck className="mr-2 h-4 w-4" />
              {refreshQuotes.isPending ? "Quoting shipping" : "Refresh UK shipping quotes"}
            </Button>
            <Button size="sm" onClick={() => runAudit.mutate()} disabled={runAudit.isPending}>
              <Calculator className="mr-2 h-4 w-4" />
              {runAudit.isPending ? "Auditing" : "Run pricing audit"}
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Cost coverage"
          value={coverage ? `${coverage.withCost}/${coverage.variants}` : "Unknown"}
          hint={
            coverage?.lastSyncedAt
              ? `Last read ${new Date(coverage.lastSyncedAt).toLocaleString("en-GB")}`
              : "Cost data has not been read from the store yet"
          }
        />
        <Metric
          label="Ready to reprice"
          value={String(totals?.ready_to_reprice ?? 0)}
          hint="Variants with a full, verified cost basis"
        />
        <Metric
          label="Already correct"
          value={String(totals?.already_correct ?? 0)}
          hint="The live price already matches the formula"
        />
        <Metric label="Held" value={String(heldTotal)} hint="Missing or unreliable cost inputs" />
        <Metric
          label="Missing cost"
          value={String(totals?.held_missing_cost ?? 0)}
          hint="No cost of goods recorded in the store"
        />
        <Metric
          label="Missing UK shipping"
          value={String(totals?.held_missing_uk_shipping ?? 0)}
          hint="No confirmed destination shipping cost"
        />
        <Metric
          label="Stale shipping quote"
          value={String(totals?.held_stale_shipping_quote ?? 0)}
          hint="The destination quote is older than the freshness policy allows"
        />
        <Metric
          label="Unreliable linkage"
          value={String(totals?.held_unreliable_linkage ?? 0)}
          hint="Predates the supplier integration or the basis is not comparable"
        />
        <Metric
          label="Excluded"
          value={String(totals?.excluded_by_policy ?? 0)}
          hint="Suppressed duplicates and listings that are not active"
        />
      </div>

      <SectionCard
        title="Audit results"
        description={
          run
            ? `${run.message ?? ""} Run at ${new Date(run.created_at).toLocaleString("en-GB")}.`
            : "No audit has been run yet. Refresh the cost data first, then run the audit."
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="rounded-md border border-border bg-background px-2 py-1 text-sm"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="all">All statuses</option>
              {Object.entries(AUDIT_STATUS_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="outline"
              disabled={!run || selected.length === 0 || applyAudit.isPending}
              onClick={() => run && applyAudit.mutate({ runId: run.id, itemIds: selected })}
            >
              Apply to {selected.length || 0} selected
            </Button>
            <Button
              size="sm"
              disabled={!run || eligibleIds.length === 0 || applyAudit.isPending}
              onClick={() => run && applyAudit.mutate({ runId: run.id })}
            >
              <ShieldCheck className="mr-2 h-4 w-4" />
              Apply all eligible
            </Button>
          </div>
        }
      >
        {items.length === 0 ? (
          <EmptyState
            title="Nothing to show"
            description="Run the audit, or choose a different status filter."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>Product</TableHead>
                  <TableHead>Variant</TableHead>
                  <TableHead>Current</TableHead>
                  <TableHead>Cost</TableHead>
                  <TableHead>UK shipping</TableHead>
                  <TableHead>Landed (protected)</TableHead>
                  <TableHead>Required</TableHead>
                  <TableHead>Advertised</TableHead>
                  <TableHead>Fee</TableHead>
                  <TableHead>Payout</TableHead>
                  <TableHead>Profit</TableHead>
                  <TableHead>Current margin</TableHead>
                  <TableHead>Expected margin</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reason and sources</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <input
                        type="checkbox"
                        aria-label={`Select ${item.product_title} ${item.variant_title}`}
                        disabled={item.status !== "ready_to_reprice"}
                        checked={selected.includes(item.id)}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked
                              ? [...current, item.id]
                              : current.filter((id) => id !== item.id),
                          )
                        }
                      />
                    </TableCell>
                    <TableCell className="text-sm text-foreground">{item.product_title}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {item.variant_title}
                    </TableCell>
                    <TableCell>{formatMoney(item.current_price, item.currency)}</TableCell>
                    <TableCell>{formatMoney(item.unit_cost, item.currency)}</TableCell>
                    <TableCell>{formatMoney(item.shipping_cost, item.currency)}</TableCell>
                    <TableCell>
                      {formatMoney(item.protected_landed_cogs ?? item.landed_cost, item.currency)}
                    </TableCell>
                    <TableCell>{formatMoney(item.required_price ?? null, item.currency)}</TableCell>
                    <TableCell className="font-medium">
                      {formatMoney(item.calculated_price, item.currency)}
                    </TableCell>
                    <TableCell>{formatMoney(item.expected_fee ?? null, item.currency)}</TableCell>
                    <TableCell>{formatMoney(item.expected_payout ?? null, item.currency)}</TableCell>
                    <TableCell>{formatMoney(item.expected_profit ?? null, item.currency)}</TableCell>
                    <TableCell>{formatPercent(item.current_margin)}</TableCell>
                    <TableCell>{formatPercent(item.expected_margin ?? item.proposed_margin)}</TableCell>
                    <TableCell>
                      <StatusPill tone={STATUS_TONE[item.status]}>
                        {AUDIT_STATUS_LABEL[item.status] ?? item.status}
                      </StatusPill>
                    </TableCell>
                    <TableCell className="max-w-[260px] text-xs text-muted-foreground">
                      {item.reason ?? "Within policy"}
                      <span className="block opacity-70">
                        {[item.cost_source, item.shipping_source, item.shipping_service]
                          .filter(Boolean)
                          .join(" · ") || "No cost source recorded"}
                      </span>
                      <span className="block opacity-70">
                        {item.fx_effective_rate
                          ? `Protected rate ${Number(item.fx_effective_rate).toFixed(4)} ${
                              item.supplier_currency ?? "USD"
                            } to ${item.currency}${item.fx_as_of ? `, reference ${item.fx_as_of}` : ""}`
                          : "No protected exchange rate applied"}
                      </span>
                      <span className="block opacity-70">
                        {item.shipping_quoted_at
                          ? `Shipping quoted ${new Date(item.shipping_quoted_at).toLocaleDateString("en-GB")}${
                              item.shipping_destination ? ` for ${item.shipping_destination}` : ""
                            }`
                          : "No dated destination shipping quote"}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Repricing history"
        description="Every applied change keeps its old price, new price, formula inputs and timestamp."
      >
        {revisions.length === 0 ? (
          <EmptyState
            title="No prices have been changed"
            description="No repricing has been applied to the catalogue from this console."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Variant</TableHead>
                  <TableHead>Old</TableHead>
                  <TableHead>New</TableHead>
                  <TableHead>Landed</TableHead>
                  <TableHead>Target margin</TableHead>
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {revisions.map((revision) => (
                  <TableRow key={revision.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(revision.created_at).toLocaleString("en-GB")}
                    </TableCell>
                    <TableCell className="text-sm text-foreground">
                      {revision.variant_title ?? revision.shopify_variant_id}
                    </TableCell>
                    <TableCell>{formatMoney(revision.old_price)}</TableCell>
                    <TableCell className="font-medium">{formatMoney(revision.new_price)}</TableCell>
                    <TableCell>{formatMoney(revision.landed_cost)}</TableCell>
                    <TableCell>{formatPercent(revision.target_margin)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {[revision.cost_source, revision.shipping_source].filter(Boolean).join(" · ")}
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
