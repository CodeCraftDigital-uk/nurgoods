/**
 * Existing catalogue repricing types.
 *
 * The audit is always produced in preview form first. Nothing in this module
 * changes a live price unless an administrator explicitly applies a reviewed
 * audit run.
 */

export const AUDIT_STATUSES = [
  "ready_to_reprice",
  "already_correct",
  "held_missing_cost",
  "held_missing_uk_shipping",
  "held_stale_shipping_quote",
  "held_unreliable_linkage",
  "excluded_by_policy",
] as const;

export type AuditStatus = (typeof AUDIT_STATUSES)[number];

export const AUDIT_STATUS_LABEL: Record<AuditStatus, string> = {
  ready_to_reprice: "Ready to reprice",
  already_correct: "Already correct",
  held_missing_cost: "Held, missing cost",
  held_missing_uk_shipping: "Held, missing UK shipping",
  held_stale_shipping_quote: "Held, shipping quote too old",
  held_unreliable_linkage: "Held, unreliable linkage",
  excluded_by_policy: "Excluded by policy",
};


export interface PricingAuditItem {
  id: string;
  run_id: string;
  product_id: string | null;
  shopify_product_id: string;
  handle: string | null;
  product_title: string | null;
  shopify_variant_id: string;
  variant_title: string | null;
  currency: string;
  current_price: number | null;
  unit_cost: number | null;
  cost_source: string | null;
  shipping_cost: number | null;
  shipping_source: string | null;
  landed_cost: number | null;
  calculated_price: number | null;
  current_margin: number | null;
  proposed_margin: number | null;
  status: AuditStatus;
  reason: string | null;
  supplier_currency?: string | null;
  supplier_shipping_source_amount?: number | null;
  supplier_landed_total_source?: number | null;
  fx_reference_rate?: number | null;
  fx_source?: string | null;
  fx_as_of?: string | null;
  fx_buffer_pct?: number | null;
  fx_effective_rate?: number | null;
  protected_landed_cogs?: number | null;
  fee_variable?: number | null;
  fee_fixed?: number | null;
  required_price?: number | null;
  expected_fee?: number | null;
  expected_payout?: number | null;
  expected_profit?: number | null;
  expected_margin?: number | null;
  promo_price?: number | null;
  promo_profit?: number | null;
  promo_margin?: number | null;
  promo_within_floor?: boolean | null;
  shipping_service?: string | null;
  shipping_destination?: string | null;
  shipping_quoted_at?: string | null;
  evidence_status?: string | null;
}


export type AuditTotals = Record<AuditStatus, number> & {
  variants: number;
  products: number;
  productsReprisable: number;
  productsHeld: number;
};

export interface PricingAuditRun {
  id: string;
  mode: string;
  status: string;
  message: string | null;
  totals: AuditTotals;
  settings: Record<string, string | number | boolean | null>;
  created_at: string;
  completed_at: string | null;
}

export interface PriceRevision {
  id: string;
  shopify_product_id: string;
  shopify_variant_id: string;
  variant_title: string | null;
  old_price: number | null;
  new_price: number;
  unit_cost: number | null;
  shipping_cost: number | null;
  landed_cost: number | null;
  target_margin: number | null;
  cost_source: string | null;
  shipping_source: string | null;
  source: string;
  created_at: string;
}

export interface ApplyPricingResult {
  attempted: number;
  updated: number;
  skipped: number;
  failures: string[];
  message: string;
}
