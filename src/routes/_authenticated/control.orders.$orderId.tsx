import { useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  getCommerceOrder,
  linkExternalSupplierOrder,
  readSupplierSnapshot,
  setOrderReviewState,
  type SupplierSnapshot,
} from "@/lib/commerce/commerce.functions";
import {
  dateTime,
  money,
  realisedMargin,
  stateLabel,
  stateTone,
} from "@/lib/commerce/presentation";
import { reconcileOrderEconomics } from "@/lib/pricing/economics";
import { ATTENTION_STATES } from "@/lib/commerce/types";

export const Route = createFileRoute("/_authenticated/control/orders/$orderId")({
  component: OrderDetailPage,
});

const ATTENTION = new Set<string>(ATTENTION_STATES);

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3 py-1.5">
      <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

function OrderDetailPage() {
  const { orderId } = Route.useParams();
  const queryClient = useQueryClient();
  const detailFn = useServerFn(getCommerceOrder);
  const reviewFn = useServerFn(setOrderReviewState);
  const linkFn = useServerFn(linkExternalSupplierOrder);
  const snapshotFn = useServerFn(readSupplierSnapshot);

  const [note, setNote] = useState("");
  const [storeId, setStoreId] = useState("");
  const [supplierOrderId, setSupplierOrderId] = useState("");
  const [snapshot, setSnapshot] = useState<SupplierSnapshot | null>(null);

  const detail = useQuery({
    queryKey: ["commerce-order", orderId],
    queryFn: () => detailFn({ data: { orderId } }),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["commerce-order", orderId] });
    await queryClient.invalidateQueries({ queryKey: ["commerce-orders"] });
  };

  const review = useMutation({
    mutationFn: (action: "resolve" | "requeue") =>
      reviewFn({ data: { orderId, action, ...(note.trim() ? { note: note.trim() } : {}) } }),
    onSuccess: async (result) => {
      toast.success(result.message);
      setNote("");
      await invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const link = useMutation({
    mutationFn: () =>
      linkFn({
        data: {
          orderId,
          zendropStoreId: Number(storeId),
          zendropOrderId: Number(supplierOrderId),
        },
      }),
    onSuccess: async () => {
      toast.success("Supplier order linked. Tracking will now be followed automatically.");
      setStoreId("");
      setSupplierOrderId("");
      await invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const lookup = useMutation({
    mutationFn: () => snapshotFn({ data: { orderId } }),
    onSuccess: (result) => {
      setSnapshot(result);
      if (!result.available) toast.message(result.message);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (detail.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading order.</p>;
  }

  const order = detail.data?.order ?? null;
  if (!order) {
    return (
      <div className="space-y-6">
        <PageHeader title="Order not found" description="This order is no longer in the ledger." />
        <Link to="/control/orders" className="text-sm underline">
          Back to orders
        </Link>
      </div>
    );
  }

  const lines = detail.data?.lines ?? [];
  const events = detail.data?.events ?? [];
  const deliveries = detail.data?.deliveries ?? [];
  const settings = detail.data?.settings;
  const unmapped = lines.filter((line) => !line.zendrop_line_item_id);
  const dispatchLocked = Boolean(order.dispatch_idempotency_key || order.zendrop_order_id);
  const margin = realisedMargin({
    orderTotal: order.order_total,
    orderCurrency: order.currency,
    supplierTotal: order.supplier_total,
    supplierCurrency: order.supplier_currency,
    paymentAmount: order.supplier_payment_amount,
    paymentCurrency: order.supplier_payment_currency,
  });

  const economics = reconcileOrderEconomics({
    grossPayment: order.actual_gross_payment ?? order.order_total,
    paymentFee: order.actual_payment_fee,
    payout: order.actual_payout,
    supplierCostSource: order.actual_supplier_cost_source ?? order.supplier_total,
    supplierCostSettlement: order.actual_supplier_cost_settlement,
    forecastProfit: order.forecast_profit,
  });
  const percent = (value: number | null) =>
    value === null ? "Not evidenced" : `${(value * 100).toFixed(1)}%`;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Orders & Fulfilment"
        title={order.shopify_order_name ?? "Order"}
        description="Full record of this order across the store, the platform and the supplier."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={stateTone(order.orchestration_state)}>
              {stateLabel(order.orchestration_state)}
            </StatusPill>
            <Button asChild variant="outline" className="min-h-9">
              <Link to="/control/orders">Back to orders</Link>
            </Button>
          </div>
        }
      />

      {dispatchLocked ? (
        <div className="rounded-xl border border-border bg-muted/50 px-5 py-4 text-sm text-muted-foreground">
          A supplier order is already recorded for this order, so no further supplier dispatch can
          be made from the platform. This is the duplicate submission safeguard.
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Store" description="What the store itself reports.">
          <Row
            label="Order id"
            value={<span className="break-all">{order.shopify_order_id}</span>}
          />
          <Row label="Order number" value={order.shopify_order_number ?? "Not recorded"} />
          <Row label="Payment status" value={order.shopify_financial_status ?? "Not recorded"} />
          <Row
            label="Fulfilment status"
            value={order.shopify_fulfillment_status ?? "Not recorded"}
          />
          <Row label="Order total" value={money(order.order_total, order.currency)} />
          <Row
            label="Ship to"
            value={
              [order.shipping_city, order.shipping_country].filter(Boolean).join(", ") ||
              "Not recorded"
            }
          />
          <Row label="Paid" value={dateTime(order.paid_at)} />
        </SectionCard>

        <SectionCard
          title="Supplier"
          description="What the supplier side of this order looks like."
        >
          <Row label="Supplier store" value={order.zendrop_store_id ?? "Not linked"} />
          <Row label="Supplier order" value={order.zendrop_order_id ?? "Not linked"} />
          <Row label="Supplier reference" value={order.zendrop_order_number ?? "Not recorded"} />
          <Row label="Supplier status" value={order.supplier_status ?? "Not recorded"} />
          <Row label="Submitted" value={dateTime(order.submitted_at)} />
          <Row
            label="Dispatch key"
            value={<span className="break-all">{order.dispatch_idempotency_key ?? "None"}</span>}
          />
          <Row label="Retries" value={order.retry_count ?? 0} />
          {order.last_error ? (
            <p className="mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {order.last_error}
            </p>
          ) : null}
        </SectionCard>

        <SectionCard
          title="Money"
          description="Amounts are shown in the currency each side actually recorded. No exchange rate is applied."
        >
          <Row label="Customer paid" value={money(order.order_total, order.currency)} />
          <Row
            label="Supplier product cost"
            value={money(order.supplier_product_cost, order.supplier_currency)}
          />
          <Row
            label="Supplier shipping"
            value={money(order.supplier_shipping_cost, order.supplier_currency)}
          />
          <Row label="Supplier fees" value={money(order.supplier_fees, order.supplier_currency)} />
          <Row
            label="Supplier total"
            value={money(order.supplier_total, order.supplier_currency)}
          />
          <Row
            label="Card charged"
            value={money(order.supplier_payment_amount, order.supplier_payment_currency)}
          />
          <div className="mt-3 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            Realised margin: {margin.label}
          </div>
        </SectionCard>

        <SectionCard
          title="Economics, forecast against actual"
          description="Only evidenced figures are shown. Nothing here is estimated or back filled from an assumed exchange rate."
        >
          <Row
            label="Customer payment taken"
            value={money(order.actual_gross_payment ?? order.order_total, order.currency)}
          />
          <Row label="Store payment fee" value={money(order.actual_payment_fee, order.currency)} />
          <Row label="Payout received" value={money(order.actual_payout, order.currency)} />
          <Row
            label="Supplier charge, supplier currency"
            value={money(
              order.actual_supplier_cost_source ?? order.supplier_total,
              order.supplier_currency,
            )}
          />
          <Row
            label="Supplier charge, settled"
            value={money(order.actual_supplier_cost_settlement, order.supplier_payment_currency)}
          />
          <Row
            label="Realised exchange rate"
            value={
              economics.realisedFxRate === null
                ? "Not derivable"
                : economics.realisedFxRate.toFixed(4)
            }
          />
          <Row label="Realised profit" value={money(economics.realisedProfit, order.currency)} />
          <Row label="Realised margin" value={percent(economics.realisedMargin)} />
          <Row label="Forecast profit" value={money(order.forecast_profit, order.currency)} />
          <Row
            label="Variance against forecast"
            value={money(economics.profitVariance, order.currency)}
          />
          {economics.note ? (
            <p className="mt-3 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              {economics.note}
            </p>
          ) : null}
          {order.economics_note ? (
            <p className="mt-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              {order.economics_note}
            </p>
          ) : null}
        </SectionCard>

        <SectionCard title="Tracking" description="Delivery progress as recorded by the platform.">
          <Row label="Tracking number" value={order.tracking_number ?? "Not recorded"} />
          <Row label="Carrier" value={order.tracking_carrier ?? "Not recorded"} />
          <Row
            label="Tracking link"
            value={
              order.tracking_url ? (
                <a
                  href={order.tracking_url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-4"
                >
                  Open
                </a>
              ) : (
                "Not recorded"
              )
            }
          />
          <Row label="Shipped" value={dateTime(order.shipped_at)} />
          <Row label="Delivered" value={dateTime(order.delivered_at)} />

          <div className="mt-4 space-y-3">
            <Button
              variant="outline"
              className="min-h-9"
              disabled={lookup.isPending || !order.zendrop_order_id}
              onClick={() => lookup.mutate()}
            >
              {lookup.isPending ? "Checking supplier" : "Read supplier status"}
            </Button>
            <p className="text-xs text-muted-foreground">
              This only reads from the supplier. It does not quote, reserve, confirm or pay for
              anything.
            </p>
            {snapshot ? (
              <div className="rounded-lg border border-border p-3 text-xs">
                <p className="font-medium text-foreground">
                  {snapshot.status ?? "No status returned"}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {snapshot.trackingNumber
                    ? `${snapshot.carrier ?? "Carrier unknown"} · ${snapshot.trackingNumber}`
                    : "No tracking at the supplier yet."}
                </p>
                {snapshot.events.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-muted-foreground">
                    {snapshot.events.slice(0, 6).map((event, index) => (
                      <li key={index}>
                        {dateTime(event.at)} · {event.description ?? "No description"}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Line mapping"
        description="Store lines matched to supplier lines. Unmapped lines are why an order stops for review."
      >
        {lines.length === 0 ? (
          <EmptyState title="No lines recorded" description="This order has no stored lines." />
        ) : (
          <ul className="divide-y divide-border">
            {lines.map((line) => (
              <li key={line.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {line.title ?? "Untitled line"} × {line.quantity}
                  </p>
                  <p className="mt-0.5 break-all text-xs text-muted-foreground">
                    SKU {line.sku ?? "none"} · store line {line.shopify_line_item_id} · variant{" "}
                    {line.shopify_variant_id ?? "none"}
                  </p>
                  <p className="mt-0.5 break-all text-xs text-muted-foreground">
                    Supplier line {line.zendrop_line_item_id ?? "not mapped"} · supplier variant{" "}
                    {line.zendrop_variant_id ?? "not mapped"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={line.zendrop_line_item_id ? "positive" : "warning"}>
                    {line.zendrop_line_item_id ? "Mapped" : "Not mapped"}
                  </StatusPill>
                  <span className="text-sm text-muted-foreground">
                    {money(line.unit_price, order.currency)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
        {unmapped.length > 0 ? (
          <p className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
            {unmapped.length} line(s) have no supplier match. Supplier only extras such as a thank
            you card are normal and never need a store line.
          </p>
        ) : null}
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Operator actions"
          description="None of these contact the supplier or move money."
        >
          <div className="space-y-4">
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Optional note recorded with the decision"
              className="min-h-20"
              aria-label="Decision note"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="min-h-9"
                disabled={review.isPending || !order.zendrop_order_id}
                onClick={() => review.mutate("resolve")}
              >
                Mark resolved
              </Button>
              <Button
                variant="outline"
                className="min-h-9"
                disabled={review.isPending || dispatchLocked}
                onClick={() => review.mutate("requeue")}
              >
                Return to fulfilment queue
              </Button>
            </div>
            {!ATTENTION.has(order.orchestration_state) ? (
              <p className="text-xs text-muted-foreground">
                This order is not currently flagged for review.
              </p>
            ) : null}

            <div className="border-t border-border pt-4">
              <p className="text-sm font-medium text-foreground">
                Link a supplier order placed outside the platform
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Use this only after confirming the supplier order exists. It records the link so
                tracking is followed. It never places an order.
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <Input
                  value={storeId}
                  onChange={(event) => setStoreId(event.target.value)}
                  placeholder="Supplier store id"
                  inputMode="numeric"
                  aria-label="Supplier store id"
                  disabled={dispatchLocked}
                />
                <Input
                  value={supplierOrderId}
                  onChange={(event) => setSupplierOrderId(event.target.value)}
                  placeholder="Supplier order id"
                  inputMode="numeric"
                  aria-label="Supplier order id"
                  disabled={dispatchLocked}
                />
              </div>
              <Button
                className="mt-3 min-h-9"
                disabled={
                  link.isPending || dispatchLocked || !storeId.trim() || !supplierOrderId.trim()
                }
                onClick={() => link.mutate()}
              >
                Link supplier order
              </Button>
            </div>

            {settings ? (
              <p className="text-xs text-muted-foreground">
                Automatic supplier fulfilment is{" "}
                {settings.auto_fulfilment_enabled ? "enabled" : "off"} and supplier credit is{" "}
                {settings.allow_supplier_credit ? "allowed" : "off"}.
              </p>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard title="Store webhooks" description="Deliveries received for this order.">
          {deliveries.length === 0 ? (
            <EmptyState
              title="No deliveries recorded"
              description="Webhook deliveries for this order will appear here."
            />
          ) : (
            <ul className="divide-y divide-border">
              {deliveries.map((delivery) => (
                <li
                  key={delivery.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">
                      {delivery.topic ?? "Unknown topic"}
                    </p>
                    <p className="mt-0.5 break-all text-xs text-muted-foreground">
                      {delivery.webhook_id ?? "No delivery id"} · received{" "}
                      {dateTime(delivery.received_at)} · attempts {delivery.attempts ?? 0}
                    </p>
                    {delivery.last_error ? (
                      <p className="mt-1 text-xs text-destructive">{delivery.last_error}</p>
                    ) : null}
                  </div>
                  <StatusPill
                    tone={
                      delivery.status === "processed"
                        ? "positive"
                        : delivery.status === "failed"
                          ? "danger"
                          : "pending"
                    }
                  >
                    {delivery.status ?? "unknown"}
                  </StatusPill>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Event timeline" description="Every recorded change, newest first.">
        {events.length === 0 ? (
          <EmptyState title="No events" description="Nothing has been recorded for this order." />
        ) : (
          <ol className="space-y-4">
            {events.map((event) => (
              <li key={event.id} className="border-l-2 border-border pl-4">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={stateTone(event.to_state ?? "")}>
                    {event.to_state ? stateLabel(event.to_state) : "No state change"}
                  </StatusPill>
                  <span className="text-xs text-muted-foreground">
                    {dateTime(event.created_at)}
                  </span>
                  {event.code ? (
                    <span className="text-xs text-muted-foreground">· {event.code}</span>
                  ) : null}
                </div>
                {event.message ? (
                  <p className="mt-1 text-sm text-foreground">{event.message}</p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </SectionCard>
    </div>
  );
}
