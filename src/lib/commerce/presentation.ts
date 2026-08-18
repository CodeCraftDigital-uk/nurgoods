/**
 * Presentation helpers for the order console.
 *
 * Money is only ever formatted with a currency the ledger actually recorded.
 * Where no currency is known the value is labelled rather than assumed.
 */
import { ORCHESTRATION_STATE_LABEL, type OrchestrationState } from "./types";

export type OrderTone = "neutral" | "positive" | "pending" | "warning" | "danger";

const TONE_BY_STATE: Record<OrchestrationState, OrderTone> = {
  payment_not_confirmed: "warning",
  awaiting_supplier_order: "pending",
  awaiting_fulfilment_preview: "pending",
  awaiting_fulfilment_confirmation: "pending",
  supplier_processing: "pending",
  shipped: "positive",
  delivered: "positive",
  cancelled: "neutral",
  supplier_rejected: "danger",
  out_of_stock: "danger",
  fulfilment_failed: "danger",
  tracking_exception: "warning",
  manual_review: "warning",
};

export function stateLabel(state: string): string {
  return ORCHESTRATION_STATE_LABEL[state as OrchestrationState] ?? state.replace(/_/g, " ");
}

export function stateTone(state: string): OrderTone {
  return TONE_BY_STATE[state as OrchestrationState] ?? "neutral";
}

export function money(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) return "Not recorded";
  const value = Number(amount);
  if (!currency) return `${value.toFixed(2)} (currency not recorded)`;
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export function dateTime(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not recorded";
  return parsed.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Realised margin is only reported when both sides are genuinely expressed in
 * the same currency. No exchange rate is ever applied.
 */
export function realisedMargin(input: {
  orderTotal: number | null | undefined;
  orderCurrency: string | null | undefined;
  supplierTotal: number | null | undefined;
  supplierCurrency: string | null | undefined;
  paymentAmount?: number | null | undefined;
  paymentCurrency?: string | null | undefined;
}): { comparable: boolean; label: string } {
  const candidates: Array<{ amount: number | null | undefined; currency: string | null | undefined }> = [
    { amount: input.paymentAmount, currency: input.paymentCurrency },
    { amount: input.supplierTotal, currency: input.supplierCurrency },
  ];

  for (const candidate of candidates) {
    if (
      candidate.amount !== null &&
      candidate.amount !== undefined &&
      candidate.currency &&
      input.orderTotal !== null &&
      input.orderTotal !== undefined &&
      input.orderCurrency &&
      candidate.currency === input.orderCurrency
    ) {
      const margin = Number(input.orderTotal) - Number(candidate.amount);
      const pct = Number(input.orderTotal) > 0 ? (margin / Number(input.orderTotal)) * 100 : null;
      return {
        comparable: true,
        label: `${money(margin, input.orderCurrency)}${pct === null ? "" : ` (${pct.toFixed(1)}%)`}`,
      };
    }
  }

  return {
    comparable: false,
    label: "Not comparable. The order and supplier amounts are not recorded in the same currency.",
  };
}
