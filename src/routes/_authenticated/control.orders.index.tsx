import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { PageHeader } from "@/components/admin/PageHeader";
import { SectionCard } from "@/components/admin/SectionCard";
import { StatusPill } from "@/components/admin/StatusPill";
import { EmptyState } from "@/components/admin/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listCommerceOrders, runCommerceJob } from "@/lib/commerce/commerce.functions";
import { ATTENTION_STATES } from "@/lib/commerce/types";
import { dateTime, money, stateLabel, stateTone } from "@/lib/commerce/presentation";

export const Route = createFileRoute("/_authenticated/control/orders/")({
  component: OrdersConsolePage,
});

const ATTENTION = new Set<string>(ATTENTION_STATES);

function OrdersConsolePage() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listCommerceOrders);
  const runFn = useServerFn(runCommerceJob);
  const [search, setSearch] = useState("");

  const overview = useQuery({ queryKey: ["commerce-orders"], queryFn: () => listFn({}) });

  const run = useMutation({
    mutationFn: (jobKey: string) => runFn({ data: { jobKey } }),
    onSuccess: async (result) => {
      toast.success(result?.message ?? "Job finished");
      await queryClient.invalidateQueries({ queryKey: ["commerce-orders"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const orders = overview.data?.orders ?? [];
  const settings = overview.data?.settings;
  const jobs = overview.data?.jobs ?? [];

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return orders;
    return orders.filter((order) =>
      [
        order.shopify_order_name,
        order.shopify_order_number?.toString(),
        order.zendrop_order_id?.toString(),
        order.zendrop_order_number,
        order.tracking_number,
        order.shipping_city,
        order.shipping_country,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
  }, [orders, search]);

  const attention = filtered.filter((order) => ATTENTION.has(order.orchestration_state));
  const active = filtered.filter(
    (order) =>
      !ATTENTION.has(order.orchestration_state) &&
      !["delivered", "cancelled"].includes(order.orchestration_state),
  );
  const closed = filtered.filter((order) =>
    ["delivered", "cancelled"].includes(order.orchestration_state),
  );

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Commerce"
        title="Orders & Fulfilment"
        description="Every paid store order, its supplier state, tracking and the decisions taken on it. Nothing on this page places or confirms a supplier order."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Safety settings"
          description="These control whether the platform is allowed to place supplier orders at all."
        >
          {settings ? (
            <ul className="space-y-2 text-sm">
              <li className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Automatic supplier fulfilment</span>
                <StatusPill tone={settings.auto_fulfilment_enabled ? "warning" : "positive"}>
                  {settings.auto_fulfilment_enabled ? "Enabled" : "Off"}
                </StatusPill>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Supplier credit spending</span>
                <StatusPill tone={settings.allow_supplier_credit ? "warning" : "positive"}>
                  {settings.allow_supplier_credit ? "Allowed" : "Off"}
                </StatusPill>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Maximum orders per run</span>
                <span className="font-medium text-foreground">{settings.max_orders_per_run}</span>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Test order allowlist</span>
                <span className="font-medium text-foreground">
                  {settings.safe_test_order_ids.length}
                </span>
              </li>
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Loading settings.</p>
          )}
        </SectionCard>

        <SectionCard
          title="Scheduled order jobs"
          description="The two background jobs that move orders forward and follow tracking."
        >
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No order jobs are registered.</p>
          ) : (
            <ul className="space-y-3">
              {jobs.map((job) => (
                <li key={job.job_key} className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{job.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {job.schedule_cron ?? "No schedule"} · last run {dateTime(job.last_run_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill tone={job.enabled ? "positive" : "neutral"}>
                      {job.enabled ? "Enabled" : "Paused"}
                    </StatusPill>
                    <Button
                      variant="outline"
                      className="min-h-9"
                      disabled={run.isPending}
                      onClick={() => run.mutate(job.job_key)}
                    >
                      Run now
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Orders"
        description={`${orders.length} recorded. Orders needing a person are listed first.`}
        actions={
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search order, supplier order or tracking"
            className="h-9 w-full sm:w-72"
            aria-label="Search orders"
          />
        }
      >
        {overview.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading orders.</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No orders to show"
            description="Paid store orders arrive here automatically once the store confirms payment."
          />
        ) : (
          <div className="space-y-8">
            <OrderGroup title="Needs attention" orders={attention} />
            <OrderGroup title="In progress" orders={active} />
            <OrderGroup title="Closed" orders={closed} />
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function OrderGroup({
  title,
  orders,
}: {
  title: string;
  orders: Array<{
    id: string;
    shopify_order_name: string | null;
    orchestration_state: string;
    currency: string | null;
    order_total: number | null;
    zendrop_order_id: number | null;
    tracking_number: string | null;
    shipping_city: string | null;
    shipping_country: string | null;
    paid_at: string | null;
  }>;
}) {
  if (orders.length === 0) return null;
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {title} ({orders.length})
      </h3>
      <ul className="mt-3 divide-y divide-border">
        {orders.map((order) => (
          <li key={order.id} className="py-3">
            <Link
              to="/control/orders/$orderId"
              params={{ orderId: order.id }}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg px-2 py-1 transition hover:bg-muted/60"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {order.shopify_order_name ?? "Unnamed order"}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {money(order.order_total, order.currency)} ·{" "}
                  {[order.shipping_city, order.shipping_country].filter(Boolean).join(", ") ||
                    "No address recorded"}{" "}
                  · paid {dateTime(order.paid_at)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {order.zendrop_order_id ? (
                  <StatusPill tone="neutral">Supplier {order.zendrop_order_id}</StatusPill>
                ) : (
                  <StatusPill tone="warning">No supplier order</StatusPill>
                )}
                {order.tracking_number ? <StatusPill tone="positive">Tracking</StatusPill> : null}
                <StatusPill tone={stateTone(order.orchestration_state)}>
                  {stateLabel(order.orchestration_state)}
                </StatusPill>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
