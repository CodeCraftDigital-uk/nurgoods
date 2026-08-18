/**
 * Supplier sourcing and pricing types.
 *
 * Zendrop stays the supplier and fulfilment layer. This module only automates
 * the upstream step of moving a supplier catalogue product into the supplier
 * account so the existing store sync can then pick it up. Nothing here creates
 * a supplier product directly in the store.
 */

export const CANDIDATE_STATES = [
  "candidate",
  "validated",
  "priced",
  "duplicate_checked",
  "queued",
  "importing",
  "imported",
  "linked",
  "detected_in_store",
  "live",
  "held",
  "failed",
] as const;

export type CandidateState = (typeof CANDIDATE_STATES)[number];

export const CANDIDATE_STATE_LABEL: Record<CandidateState, string> = {
  candidate: "Candidate",
  validated: "Validated",
  priced: "Priced",
  duplicate_checked: "Duplicate checked",
  queued: "Queued",
  importing: "Importing",
  imported: "In supplier products",
  linked: "Linked to the store",
  detected_in_store: "Detected by store sync",
  live: "Live",
  held: "Held",
  failed: "Failed",
};

/** Capability roles the adapter needs. Names are discovered at runtime. */
export const CAPABILITY_ROLES = [
  "catalogue_search",
  "catalogue_product",
  "catalogue_shipping",
  "my_products_list",
  "my_products_get",
  "my_products_import",
  "my_products_push",
  "import_operation",
  "stores_list",
  "orders_list",
  "order_get",
  "order_fulfilment_cost",
  "order_fulfil",
  "order_fulfilment_operation",
  "order_tracking",
  "order_cancel",
  "order_issues",
] as const;

export type CapabilityRole = (typeof CAPABILITY_ROLES)[number];

export const CAPABILITY_ROLE_LABEL: Record<CapabilityRole, string> = {
  catalogue_search: "Browse supplier catalogue",
  catalogue_product: "Read a supplier product",
  catalogue_shipping: "Quote supplier shipping",
  my_products_list: "Read supplier products",
  my_products_get: "Read one supplier product",
  my_products_import: "Add to supplier products",
  my_products_push: "Send to the connected store",
  import_operation: "Track the supplier import",
  stores_list: "Read connected stores",
  orders_list: "Read supplier orders",
  order_get: "Read one supplier order",
  order_fulfilment_cost: "Quote a fulfilment cost",
  order_fulfil: "Fulfil a supplier order",
  order_fulfilment_operation: "Track a fulfilment operation",
  order_tracking: "Read tracking events",
  order_cancel: "Cancel a supplier order",
  order_issues: "Read order issues",
};


export interface CapabilityReport {
  role: CapabilityRole;
  label: string;
  actionName: string | null;
  available: boolean;
  kind: "read" | "write" | "unknown";
}

export interface ZendropConnectionStatus {
  configured: boolean;
  connectionState: "not_connected" | "connected" | "error";
  fingerprint: string | null;
  expiresOn: string | null;
  expiresInDays: number | null;
  scopes: string[];
  storeLabel: string | null;
  lastTestedAt: string | null;
  lastError: string | null;
  capabilities: CapabilityReport[];
  massImportUnlocked: boolean;
  testPassedAt: string | null;
}

export interface PricingSettings {
  pricing_mode: string;
  target_margin: number;
  rounding_mode: "charm_99" | "whole" | "none";
  min_promo_margin: number;
  promo_discount: number;
  shipping_market: string;
  currency: string;
  allow_incomplete_pricing: boolean;
  /** Where the reference exchange rate is taken from. */
  fx_source: string;
  /** Protection applied on top of the reference rate before pricing. */
  fx_buffer_pct: number;
  /** How old a reference exchange rate may be before it is refused. */
  fx_quote_max_age_hours: number;
  /** How old a supplier shipping quote may be before it is refused. */
  shipping_quote_max_age_days: number;
  /** Proportion of the selling price taken by the payment provider. */
  payment_fee_variable: number;
  /** Fixed amount taken per transaction, in the selling currency. */
  payment_fee_fixed: number;
  /** Market that receives free delivery at the checkout. */
  free_shipping_market: string;
  /** Every market the store sells and fulfils into, for example GB and US. */
  supported_markets: string[];
  /** Supported markets that receive free delivery. Never wider than the above. */
  free_shipping_markets: string[];
}


export interface SourcingRules {
  enabled: boolean;
  allowed_categories: string[];
  blocked_categories: string[];
  require_stock: boolean;
  require_image: boolean;
  require_uk_shipping: boolean;
  duplicate_precheck: boolean;
  min_landed_cost: number | null;
  max_landed_cost: number | null;
  max_retail_price: number | null;
  min_retail_price: number | null;
  min_suitability_score: number;
  restricted_keywords: string[];
  max_variant_count: number | null;
  continuous_sourcing: boolean;
  target_catalogue_size: number | null;
  daily_import_cap: number;
  batch_size: number;
}

export interface CatalogueVariant {
  id: string;
  title: string;
  sku: string | null;
  cost: number | null;
  shippingCost: number | null;
  suggestedRetail: number | null;
  inventory: number | null;
}

export interface CatalogueItem {
  id: string;
  title: string;
  imageUrl: string | null;
  category: string | null;
  cost: number | null;
  shippingCost: number | null;
  /** Named supplier service the shipping figure was quoted for. */
  shippingService?: string | null;
  /** Destination the shipping figure was quoted for. */
  shippingDestination?: string | null;
  /** When the shipping figure was quoted. */
  shippingQuotedAt?: string | null;
  suggestedRetail: number | null;
  inventory: number | null;
  shipsFrom: string | null;
  deliveryEstimate: string | null;
  currency: string;
  variants: CatalogueVariant[];
}


export interface CatalogueSearchResult {
  items: CatalogueItem[];
  nextCursor: string | null;
  page: number;
  total: number | null;
  available: boolean;
  message: string | null;
}

export interface PricingBreakdown {
  supplierCost: number | null;
  shippingCost: number | null;
  landedCost: number | null;
  targetMargin: number;
  price: number | null;
  suggestedRetail: number | null;
  grossProfit: number | null;
  grossMargin: number | null;
  promoDiscount: number;
  promoPrice: number | null;
  promoMargin: number | null;
  promoWithinFloor: boolean;
  complete: boolean;
  reason: string | null;
}

export interface CandidateRow {
  id: string;
  zendrop_product_id: string;
  title: string;
  image_url: string | null;
  category: string | null;
  state: CandidateState;
  hold_reason: string | null;
  failure_reason: string | null;
  is_test: boolean;
  currency: string;
  supplier_cost: number | null;
  shipping_cost: number | null;
  landed_cost: number | null;
  calculated_price: number | null;
  suggested_retail: number | null;
  gross_margin: number | null;
  pricing_complete: boolean;
  shopify_product_id: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
}

export interface SourcingCounters {
  total: number;
  queued: number;
  importedToday: number;
  failedOrHeld: number;
  live: number;
}

export interface RateLimitSnapshot {
  readsRemaining: number;
  writesRemaining: number;
  readLimit: number;
  writeLimit: number;
  windowSeconds: number;
}
