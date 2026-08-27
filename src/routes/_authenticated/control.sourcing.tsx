import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Lock, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { SectionCard } from "@/components/admin/SectionCard";
import { EmptyState } from "@/components/admin/EmptyState";
import { StatusPill } from "@/components/admin/StatusPill";
import { ZendropConnectionPanel } from "@/components/admin/ZendropConnectionPanel";
import { SupplierSyncPanel } from "@/components/admin/SupplierSyncPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  getSourcingOverview,
  queueForImport,
  reconcileImportsFn,
  runOneProductTestFn,
  runSourcingBatch,
  screenSupplierCatalogue,
  searchSupplierCatalogue,
  selectForImport,
  updatePricingSettings,
  updateSourcingRules,
} from "@/lib/zendrop/zendrop.functions";
import { computePricing, formatMoney, formatPercent } from "@/lib/zendrop/pricing";
import { CANDIDATE_STATE_LABEL, type CandidateState } from "@/lib/zendrop/types";

export const Route = createFileRoute("/_authenticated/control/sourcing")({
  component: SourcingPage,
});

function stateTone(state: CandidateState) {
  if (state === "live" || state === "imported" || state === "detected_in_store")
    return "positive" as const;
  if (state === "held") return "warning" as const;
  if (state === "failed") return "danger" as const;
  if (state === "candidate") return "neutral" as const;
  return "pending" as const;
}

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

function SourcingPage() {
  const queryClient = useQueryClient();
  const [stateFilter, setStateFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [testProductId, setTestProductId] = useState("");
  const [screenQuery, setScreenQuery] = useState("");
  const [screenTarget, setScreenTarget] = useState(25);

  const overviewFn = useServerFn(getSourcingOverview);
  const overview = useQuery({
    queryKey: ["sourcing-overview", stateFilter],
    queryFn: () => overviewFn({ data: { state: stateFilter } }),
    retry: false,
    refetchInterval: 60_000,
  });

  const searchFn = useServerFn(searchSupplierCatalogue);
  const catalogue = useQuery({
    queryKey: ["supplier-catalogue", term, page],
    queryFn: () => searchFn({ data: { query: term, page, limit: 24 } }),
    retry: false,
    enabled: Boolean(overview.data?.connection.configured),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["sourcing-overview"] });
    void queryClient.invalidateQueries({ queryKey: ["zendrop-status"] });
  };

  const selectFn = useServerFn(selectForImport);
  const select = useMutation({
    mutationFn: (productIds: string[]) => selectFn({ data: { productIds } }),
    onSuccess: (result) => {
      toast.success(`${result.created} ready, ${result.held} held, ${result.skipped} skipped.`);
      setSelected([]);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const queueFn = useServerFn(queueForImport);
  const queueMutation = useMutation({
    mutationFn: (candidateIds: string[]) => queueFn({ data: { candidateIds } }),
    onSuccess: (result) => {
      toast.success(`${result.imported} imported from ${result.queued} queued.`);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const testFn = useServerFn(runOneProductTestFn);
  const test = useMutation({
    mutationFn: (productId: string) => testFn({ data: { productId } }),
    onSuccess: (result) => {
      if (result.passed) toast.success("The one product test passed. Mass import is now unlocked.");
      else
        toast.error(result.steps.find((s) => s.status === "failed")?.detail ?? "The test failed.");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const screenFn = useServerFn(screenSupplierCatalogue);
  const screen = useMutation({
    mutationFn: () =>
      screenFn({ data: { query: screenQuery.trim() || undefined, target: screenTarget } }),
    onSuccess: (result) => toast.success(result.message),
    onError: (error: Error) => toast.error(error.message),
  });

  const batchFn = useServerFn(runSourcingBatch);
  const batch = useMutation({
    mutationFn: (productIds: string[]) =>
      batchFn({ data: { productIds, batchSize: screenTarget } }),
    onSuccess: (result) => {
      toast.success(`${result.imported} imported from ${result.queued} queued.`);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const reconcileFn = useServerFn(reconcileImportsFn);
  const reconcile = useMutation({
    mutationFn: () => reconcileFn({}),
    onSuccess: (result) => {
      toast.success(`${result.matched} imports matched to store products.`);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const pricingFn = useServerFn(updatePricingSettings);
  const savePricing = useMutation({
    mutationFn: (patch: Record<string, unknown>) => pricingFn({ data: patch as never }),
    onSuccess: () => {
      toast.success("Pricing policy saved.");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rulesFn = useServerFn(updateSourcingRules);
  const saveRules = useMutation({
    mutationFn: (patch: Record<string, unknown>) => rulesFn({ data: patch as never }),
    onSuccess: () => {
      toast.success("Sourcing rules saved.");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const connection = overview.data?.connection;
  const pricing = overview.data?.pricing;
  const rules = overview.data?.rules;
  const counters = overview.data?.counters;
  const rate = overview.data?.rateLimit;
  const candidates = overview.data?.candidates ?? [];
  const massLocked = !connection?.massImportUnlocked;

  const screened = screen.data?.products ?? [];

  const readyIds = useMemo(
    () =>
      candidates
        .filter((c) => c.state === "duplicate_checked" || c.state === "priced")
        .map((c) => c.id),
    [candidates],
  );

  const previewRows = (catalogue.data?.items ?? []).map((item) => ({
    item,
    pricing: pricing
      ? computePricing({
          supplierCost: item.cost,
          shippingCost: item.shippingCost,
          suggestedRetail: item.suggestedRetail,
          settings: pricing,
        })
      : null,
  }));

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Sourcing and pricing"
        title="Supplier catalogue"
        description="Browse the supplier catalogue, price against a true gross margin target and import at a controlled pace. Fulfilment linkage always stays with the supplier."
        actions={
          <Button variant="outline" size="sm" onClick={() => reconcile.mutate()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Reconcile
          </Button>
        }
      />

      <SupplierSyncPanel snapshot={overview.data?.supplierSync} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Connection"
          value={connection?.connectionState === "connected" ? "Connected" : "Disconnected"}
          hint={connection?.fingerprint ?? "No token stored"}
        />
        <Metric
          label="Available catalogue"
          value={
            catalogue.data?.available
              ? String(catalogue.data.total ?? catalogue.data.items.length)
              : "Not available"
          }
          hint={catalogue.data?.message ?? "Live supplier results"}
        />
        <Metric
          label="Import queue"
          value={String(counters?.queued ?? 0)}
          hint="Queued and importing"
        />
        <Metric
          label="Imported today"
          value={String(counters?.importedToday ?? 0)}
          hint={`Daily cap ${rules?.daily_import_cap ?? 0}`}
        />
        <Metric
          label="Failed or held"
          value={String(counters?.failedOrHeld ?? 0)}
          hint="Needs review"
        />
        <Metric
          label="Pricing policy"
          value={formatPercent(pricing?.target_margin ?? null)}
          hint={`Target gross margin, promo floor ${formatPercent(pricing?.min_promo_margin ?? null)}`}
        />
        <Metric
          label="API allowance"
          value={rate ? `${rate.readsRemaining}/${rate.readLimit}` : "Unknown"}
          hint={rate ? `${rate.writesRemaining} of ${rate.writeLimit} writes left this minute` : ""}
        />
        <Metric
          label="Mass import"
          value={massLocked ? "Locked" : "Unlocked"}
          hint={massLocked ? "Locked until the one product test passes" : "Test passed"}
        />
      </div>

      <ZendropConnectionPanel />

      {massLocked ? (
        <div className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4">
          <Lock className="mt-0.5 h-4 w-4 text-warning" />
          <p className="text-sm text-foreground">
            Mass import is locked until the controlled one product test passes and the supplier
            confirms a supported import operation. Every write path stays disabled until then.
          </p>
        </div>
      ) : null}

      <SectionCard
        title="Pricing policy"
        description="Selling price equals landed cost divided by one minus the target gross margin. This is a true margin, never a markup on cost."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label>Target gross margin (%)</Label>
            <Input
              type="number"
              min={1}
              max={99}
              defaultValue={Math.round((pricing?.target_margin ?? 0.6) * 100)}
              onBlur={(event) =>
                savePricing.mutate({ target_margin: Number(event.target.value) / 100 })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>Protected promo margin (%)</Label>
            <Input
              type="number"
              min={0}
              max={95}
              defaultValue={Math.round((pricing?.min_promo_margin ?? 0.35) * 100)}
              onBlur={(event) =>
                savePricing.mutate({ min_promo_margin: Number(event.target.value) / 100 })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>Example promo discount (%)</Label>
            <Input
              type="number"
              min={0}
              max={90}
              defaultValue={Math.round((pricing?.promo_discount ?? 0.2) * 100)}
              onBlur={(event) =>
                savePricing.mutate({ promo_discount: Number(event.target.value) / 100 })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>Pricing market</Label>
            <Input
              defaultValue={pricing?.shipping_market ?? "GB"}
              onBlur={(event) => savePricing.mutate({ shipping_market: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Supported markets</Label>
            <Input
              defaultValue={(pricing?.supported_markets ?? ["GB", "US"]).join(", ")}
              onBlur={(event) =>
                savePricing.mutate({
                  supported_markets: event.target.value
                    .split(",")
                    .map((code) => code.trim())
                    .filter(Boolean),
                })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>Free shipping markets</Label>
            <Input
              defaultValue={(pricing?.free_shipping_markets ?? ["GB", "US"]).join(", ")}
              onBlur={(event) =>
                savePricing.mutate({
                  free_shipping_markets: event.target.value
                    .split(",")
                    .map((code) => code.trim())
                    .filter(Boolean),
                })
              }
            />
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Rounding is{" "}
          {pricing?.rounding_mode === "charm_99"
            ? "charm .99, rounded up so the margin floor always holds"
            : pricing?.rounding_mode}
          . Supplier suggested retail is reference only and never sets the NUR GOODS price.
          Supported markets are the destinations a product may be sourced and published for; a
          product qualifies only when the supplier has fresh destination specific shipping evidence
          for at least one of them. Selling prices are solved in {pricing?.currency ?? "GBP"} for
          the pricing market only, so a market in another currency needs a verified presentment
          policy before its prices can be published.
        </p>
      </SectionCard>

      <SectionCard
        title="Sourcing rules"
        description="Automated guard rails applied to every candidate before it can be queued."
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(
            [
              ["require_stock", "Stock required"],
              ["require_image", "Image required"],
              ["require_uk_shipping", "Destination shipping required"],
              ["duplicate_precheck", "Duplicate pre-check"],
              ["enabled", "Automated sourcing enabled"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-foreground">{label}</span>
              <Switch
                checked={Boolean(rules?.[key])}
                onCheckedChange={(value) => saveRules.mutate({ [key]: value })}
              />
            </label>
          ))}
          <div className="space-y-1.5">
            <Label>Daily import cap</Label>
            <Input
              type="number"
              min={1}
              defaultValue={rules?.daily_import_cap ?? 25}
              onBlur={(event) => saveRules.mutate({ daily_import_cap: Number(event.target.value) })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Batch size</Label>
            <div className="flex flex-wrap gap-1.5">
              {[25, 50, 100, 250, 500].map((size) => (
                <Button
                  key={size}
                  type="button"
                  size="sm"
                  variant={rules?.batch_size === size ? "default" : "outline"}
                  onClick={() => saveRules.mutate({ batch_size: size })}
                >
                  {size}
                </Button>
              ))}
            </div>
            <Input
              type="number"
              min={1}
              max={500}
              defaultValue={rules?.batch_size ?? 25}
              onBlur={(event) => saveRules.mutate({ batch_size: Number(event.target.value) })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Minimum suitability score</Label>
            <Input
              type="number"
              min={0}
              max={100}
              defaultValue={rules?.min_suitability_score ?? 60}
              onBlur={(event) =>
                saveRules.mutate({ min_suitability_score: Number(event.target.value) })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>Maximum variants per product</Label>
            <Input
              type="number"
              min={1}
              defaultValue={rules?.max_variant_count ?? ""}
              onBlur={(event) =>
                saveRules.mutate({
                  max_variant_count: event.target.value ? Number(event.target.value) : null,
                })
              }
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
            <Label>Restricted keywords</Label>
            <Input
              defaultValue={(rules?.restricted_keywords ?? []).join(", ")}
              placeholder="Comma separated"
              onBlur={(event) =>
                saveRules.mutate({
                  restricted_keywords: event.target.value
                    .split(",")
                    .map((value) => value.trim().toLowerCase())
                    .filter(Boolean),
                })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>Max landed cost</Label>
            <Input
              type="number"
              defaultValue={rules?.max_landed_cost ?? ""}
              onBlur={(event) =>
                saveRules.mutate({
                  max_landed_cost: event.target.value ? Number(event.target.value) : null,
                })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>Max retail price</Label>
            <Input
              type="number"
              defaultValue={rules?.max_retail_price ?? ""}
              onBlur={(event) =>
                saveRules.mutate({
                  max_retail_price: event.target.value ? Number(event.target.value) : null,
                })
              }
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Intelligent sourcing screen"
        description="Pre-screens supplier products against the sourcing rules and the margin formula. Screening reads only and never imports. Queueing a screened batch stays locked until the controlled one product test has passed."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="w-40"
              value={screenQuery}
              onChange={(event) => setScreenQuery(event.target.value)}
              placeholder="Optional keyword"
            />
            <select
              className="rounded-md border border-border bg-background px-2 py-1 text-sm"
              value={screenTarget}
              onChange={(event) => setScreenTarget(Number(event.target.value))}
            >
              {[25, 50, 100, 250, 500].map((size) => (
                <option key={size} value={size}>
                  {size} products
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="outline"
              disabled={!connection?.configured || screen.isPending}
              onClick={() => screen.mutate()}
            >
              {screen.isPending ? "Screening" : "Run screen"}
            </Button>
            <Button
              size="sm"
              disabled={massLocked || screened.length === 0 || batch.isPending}
              onClick={() =>
                batch.mutate(
                  screened
                    .filter((row) => row.score >= (rules?.min_suitability_score ?? 60))
                    .map((row) => row.productId),
                )
              }
            >
              Queue recommended batch
            </Button>
          </div>
        }
      >
        {screen.data ? (
          <div className="mb-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {(
              [
                ["Screened", screen.data.funnel.queried],
                ["Restricted", screen.data.funnel.restricted],
                ["Category excluded", screen.data.funnel.categoryExcluded],
                ["Quality failed", screen.data.funnel.qualityFailed],
                ["Delivery unsuitable", screen.data.funnel.ukUnsuitable],
                ["Pricing failed", screen.data.funnel.pricingFailed],
                ["Duplicate excluded", screen.data.funnel.duplicateExcluded],
                ["Eligible", screen.data.funnel.eligible],
                ["Recommended", screen.data.funnel.recommended],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border bg-card/60 px-3 py-2">
                <p className="text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
                  {label}
                </p>
                <p className="text-lg font-semibold text-foreground">{value}</p>
              </div>
            ))}
          </div>
        ) : null}
        {screened.length === 0 ? (
          <EmptyState
            title="No screened products yet"
            description={
              screen.data?.message ??
              "Run a screen to score live supplier products against the sourcing rules."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Landed</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Margin</TableHead>
                  <TableHead>Reasons</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {screened.map((row) => (
                  <TableRow key={row.productId}>
                    <TableCell className="text-sm text-foreground">{row.title}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {row.category ?? "Not stated"}
                    </TableCell>
                    <TableCell>
                      <StatusPill
                        tone={
                          row.score >= (rules?.min_suitability_score ?? 60) ? "positive" : "warning"
                        }
                      >
                        {row.score}
                      </StatusPill>
                    </TableCell>
                    <TableCell>{formatMoney(row.landedCost, pricing?.currency)}</TableCell>
                    <TableCell>{formatMoney(row.price, pricing?.currency)}</TableCell>
                    <TableCell>{formatPercent(row.grossMargin)}</TableCell>
                    <TableCell className="max-w-[280px] text-xs text-muted-foreground">
                      {row.reasons
                        .filter((reason) => reason.outcome !== "pass")
                        .map((reason) => reason.detail)
                        .join(" · ") || "Meets every rule"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="One product test"
        description="Authenticate, retrieve, price, import through the supplier, confirm supplier products state, then confirm the existing store sync sees it. No order or fulfilment request is placed."
        actions={
          <StatusPill tone={connection?.testPassedAt ? "positive" : "warning"}>
            {connection?.testPassedAt ? "Passed" : "Not run"}
          </StatusPill>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1 space-y-1.5">
            <Label htmlFor="test-product">Supplier product identifier</Label>
            <Input
              id="test-product"
              value={testProductId}
              onChange={(event) => setTestProductId(event.target.value)}
              placeholder="Paste one supplier product id"
            />
          </div>
          <Button
            onClick={() => test.mutate(testProductId.trim())}
            disabled={!testProductId.trim() || !connection?.configured || test.isPending}
          >
            <ShieldCheck className="mr-2 h-4 w-4" />
            {test.isPending ? "Running" : "Run controlled test"}
          </Button>
        </div>
        {test.data ? (
          <ul className="mt-4 space-y-2">
            {test.data.steps.map((step) => (
              <li key={step.key} className="flex items-start justify-between gap-3 text-sm">
                <div>
                  <p className="text-foreground">{step.label}</p>
                  <p className="text-xs text-muted-foreground">{step.detail}</p>
                </div>
                <StatusPill
                  tone={
                    step.status === "passed"
                      ? "positive"
                      : step.status === "failed"
                        ? "danger"
                        : "pending"
                  }
                >
                  {step.status}
                </StatusPill>
              </li>
            ))}
          </ul>
        ) : null}
      </SectionCard>

      <SectionCard
        title="Supplier catalogue"
        description="Live supplier results with the NUR GOODS calculated price alongside the supplier reference price."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => select.mutate(selected)}
              disabled={selected.length === 0 || select.isPending}
            >
              Add {selected.length || ""} to candidates
            </Button>
            <Button
              size="sm"
              onClick={() => queueMutation.mutate(readyIds)}
              disabled={massLocked || readyIds.length === 0 || queueMutation.isPending}
            >
              Import queued
            </Button>
          </div>
        }
      >
        <div className="flex flex-wrap gap-2">
          <Input
            className="max-w-sm"
            value={query}
            placeholder="Search the supplier catalogue"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                setPage(1);
                setTerm(query);
              }
            }}
          />
          <Button
            variant="outline"
            onClick={() => {
              setPage(1);
              setTerm(query);
            }}
          >
            Search
          </Button>
        </div>

        {!connection?.configured ? (
          <EmptyState
            title="No supplier account connected"
            description="Store the supplier token above. Nothing is fetched or imported until a real connection exists."
          />
        ) : !catalogue.data?.available ? (
          <EmptyState
            title="Catalogue unavailable"
            description={
              catalogue.data?.message ?? "Run a connection test to discover supplier operations."
            }
          />
        ) : previewRows.length === 0 ? (
          <EmptyState title="No results" description="Try a different search term." />
        ) : (
          <>
            <div className="mt-4 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>Product</TableHead>
                    <TableHead>Cost</TableHead>
                    <TableHead>Shipping</TableHead>
                    <TableHead>Landed</TableHead>
                    <TableHead>NUR GOODS price</TableHead>
                    <TableHead>Margin</TableHead>
                    <TableHead>Promo margin</TableHead>
                    <TableHead>Supplier reference</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.map(({ item, pricing: preview }) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <input
                          type="checkbox"
                          aria-label={`Select ${item.title}`}
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
                      <TableCell>
                        <div className="flex items-center gap-3">
                          {item.imageUrl ? (
                            <img
                              src={item.imageUrl}
                              alt={item.title}
                              loading="lazy"
                              className="h-10 w-10 rounded-md object-cover"
                            />
                          ) : null}
                          <div>
                            <p className="text-sm text-foreground">{item.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {[item.category, item.shipsFrom, item.deliveryEstimate]
                                .filter(Boolean)
                                .join(" · ") || "No supplier metadata"}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{formatMoney(item.cost, item.currency)}</TableCell>
                      <TableCell>{formatMoney(item.shippingCost, item.currency)}</TableCell>
                      <TableCell>
                        {formatMoney(preview?.landedCost ?? null, pricing?.currency)}
                      </TableCell>
                      <TableCell className="font-medium">
                        {preview?.complete
                          ? formatMoney(preview.price, pricing?.currency)
                          : "Needs data"}
                      </TableCell>
                      <TableCell>{formatPercent(preview?.grossMargin ?? null)}</TableCell>
                      <TableCell>
                        <StatusPill tone={preview?.promoWithinFloor ? "positive" : "warning"}>
                          {formatPercent(preview?.promoMargin ?? null)}
                        </StatusPill>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatMoney(item.suggestedRetail, item.currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <span className="text-xs text-muted-foreground">Page {page}</span>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </>
        )}
      </SectionCard>

      <SectionCard
        title="Import queue and audit"
        description="Every candidate carries its state, pricing snapshot and supplier identifiers."
        actions={
          <select
            className="rounded-md border border-border bg-background px-2 py-1 text-sm"
            value={stateFilter}
            onChange={(event) => setStateFilter(event.target.value)}
          >
            <option value="all">All states</option>
            {Object.entries(CANDIDATE_STATE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        }
      >
        {candidates.length === 0 ? (
          <EmptyState
            title="No candidates yet"
            description="Select supplier products above to create priced candidates."
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Landed</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>Margin</TableHead>
                  <TableHead>Store product</TableHead>
                  <TableHead>Note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {candidates.map((candidate) => (
                  <TableRow key={candidate.id}>
                    <TableCell className="text-sm text-foreground">{candidate.title}</TableCell>
                    <TableCell>
                      <StatusPill tone={stateTone(candidate.state)}>
                        {CANDIDATE_STATE_LABEL[candidate.state] ?? candidate.state}
                      </StatusPill>
                    </TableCell>
                    <TableCell>{formatMoney(candidate.landed_cost, candidate.currency)}</TableCell>
                    <TableCell>
                      {formatMoney(candidate.calculated_price, candidate.currency)}
                    </TableCell>
                    <TableCell>{formatPercent(candidate.gross_margin)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {candidate.shopify_product_id ?? "Not linked yet"}
                    </TableCell>
                    <TableCell className="max-w-[220px] text-xs text-muted-foreground">
                      {candidate.hold_reason ?? candidate.failure_reason ?? ""}
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
