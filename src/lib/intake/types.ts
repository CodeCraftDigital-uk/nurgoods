/**
 * Automated Product Intake.
 *
 * Zendrop remains the supplier and Shopify remains the commerce source of
 * truth. Intake never creates or edits a supplier record: it only decides when
 * a product Shopify already holds is good enough to appear in the NUR GOODS
 * catalogue, and records why.
 */

export const INTAKE_STATES = [
  "detected",
  "validating",
  "quarantined",
  "duplicate_check",
  "classification",
  "seo",
  "approved",
  "published_to_storefront",
  "rejected",
  "failed",
] as const;

export type IntakeState = (typeof INTAKE_STATES)[number];

export const INTAKE_STATE_LABEL: Record<IntakeState, string> = {
  detected: "Detected",
  validating: "Validating",
  quarantined: "Quarantined",
  duplicate_check: "Identity check",
  classification: "Classification",
  seo: "Search intelligence",
  approved: "Approved",
  published_to_storefront: "Live on the storefront",
  rejected: "Rejected",
  failed: "Failed",
};

/** Stages that must not be visible to customers yet. */
export const BLOCKING_STATES: IntakeState[] = [
  "detected",
  "validating",
  "quarantined",
  "duplicate_check",
  "classification",
  "seo",
  "rejected",
  "failed",
];

export type IntakeSource = "webhook" | "delta_sync" | "backfill" | "manual";

export interface IntakePolicy {
  automatic_processing: boolean;
  automatic_storefront_exposure: boolean;
  require_image: boolean;
  require_purchasable_variant: boolean;
  require_valid_price: boolean;
  require_description: boolean;
  duplicate_protection: boolean;
  catalogue_classification: boolean;
  seo_intelligence: boolean;
}

export const DEFAULT_INTAKE_POLICY: IntakePolicy = {
  automatic_processing: true,
  automatic_storefront_exposure: true,
  require_image: true,
  require_purchasable_variant: true,
  require_valid_price: true,
  require_description: true,
  duplicate_protection: true,
  catalogue_classification: true,
  seo_intelligence: true,
};

export const INTAKE_POLICY_LABEL: Record<keyof IntakePolicy, string> = {
  automatic_processing: "Process new products automatically",
  automatic_storefront_exposure: "Publish to the storefront once every gate passes",
  require_image: "Require at least one real image",
  require_purchasable_variant: "Require at least one purchasable variant",
  require_valid_price: "Require a valid selling price",
  require_description: "Require basic description or specification data",
  duplicate_protection: "Run product identity and de-duplication",
  catalogue_classification: "Run canonical catalogue classification",
  seo_intelligence: "Run search intelligence",
};

export interface IntakeCheck {
  code: string;
  label: string;
  passed: boolean;
  detail?: string;
  /** Plain wording used when the check fails, so summaries read correctly. */
  failureLabel?: string;
}

/**
 * Where the product came from. A supplier origin product is pushed into the
 * store by the supplier as a staging record and NUR GOODS decides when it goes
 * live. A store origin product is managed in the store directly and its own
 * draft or archived state is always respected.
 */
export type IntakeOrigin = "supplier" | "store";

export interface IntakeRecord {
  id: string;
  shopify_product_id: string;
  product_id: string | null;
  title: string | null;
  handle: string | null;
  source: IntakeSource;
  origin: IntakeOrigin;
  state: IntakeState;
  reason_code: string | null;
  reason: string | null;
  attempts: number;
  validation: { checks?: IntakeCheck[] } | null;
  detected_at: string;
  last_transition_at: string;
  approved_at: string | null;
  published_at: string | null;
}

export interface IntakeCounters {
  detected: number;
  processing: number;
  approved: number;
  published: number;
  quarantined: number;
  rejected: number;
  failed: number;
  duplicates_suppressed: number;
  category_corrections: number;
  seo_completed: number;
}
