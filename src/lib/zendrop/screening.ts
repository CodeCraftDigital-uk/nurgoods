/**
 * Deterministic catalogue pre-screening and suitability scoring.
 *
 * The screen runs entirely on real supplier fields and simple arithmetic. No
 * model is called for filtering or numeric work, and nothing here invents a
 * product fact. Every decision carries a plain reason so an administrator can
 * see exactly why a product was recommended, held or rejected.
 */
import { computePricing } from "./pricing";
import { screenProhibited } from "@/lib/policy/prohibited";
import type { CatalogueItem, PricingSettings, SourcingRules } from "./types";

export type ScreenOutcome = "recommended" | "eligible" | "held" | "rejected";

export interface ScreenReason {
  code: string;
  label: string;
  outcome: "pass" | "warn" | "fail";
  detail: string;
  points: number;
}

export interface ScreenResult {
  outcome: ScreenOutcome;
  score: number;
  reasons: ScreenReason[];
  landedCost: number | null;
  price: number | null;
  grossMargin: number | null;
  promoWithinFloor: boolean;
  blockingReason: string | null;
}

/** Categories that are never suitable for a general UK lifestyle marketplace. */
export const DEFAULT_RESTRICTED_KEYWORDS = [
  "vape",
  "e-cigarette",
  "nicotine",
  "cbd",
  "cannabis",
  "weapon",
  "knife",
  "gun",
  "ammo",
  "firearm",
  "medicine",
  "prescription",
  "supplement",
  "alcohol",
  "tobacco",
  "adult",
  "counterfeit",
  "replica",
  "airsoft",
  "taser",
  "pepper spray",
];

function matches(haystack: string, needles: string[]): string | null {
  const text = haystack.toLowerCase();
  for (const needle of needles) {
    const token = needle.trim().toLowerCase();
    if (token && text.includes(token)) return token;
  }
  return null;
}

export interface ScreenInput {
  item: CatalogueItem;
  rules: SourcingRules;
  settings: PricingSettings;
  /** Landed cost and price already converted into the pricing currency. */
  supplierCost: number | null;
  shippingCost: number | null;
  suggestedRetail: number | null;
  duplicateReason?: string | null;
}

export function screenCandidate(input: ScreenInput): ScreenResult {
  const { item, rules, settings } = input;
  const reasons: ScreenReason[] = [];
  let score = 0;
  let blocking: string | null = null;

  const add = (
    code: string,
    label: string,
    outcome: ScreenReason["outcome"],
    detail: string,
    points: number,
  ) => {
    reasons.push({ code, label, outcome, detail, points });
    score += points;
    if (outcome === "fail" && !blocking) blocking = detail;
  };

  const haystack = [item.title, item.category ?? ""].join(" ");
  const restricted = [...DEFAULT_RESTRICTED_KEYWORDS, ...(rules.restricted_keywords ?? [])];
  const restrictedHit = matches(haystack, restricted);

  // Prohibited category control. Adult and sexual products are never suitable
  // for NUR GOODS, so the multi field screen runs before anything else and its
  // failure can never be scored away.
  const prohibited = screenProhibited({
    title: item.title,
    category: item.category,
    extra: [
      item.shipsFrom,
      ...item.variants.map((variant) => variant.title),
      ...item.variants.map((variant) => variant.sku ?? ""),
    ],
  });
  if (prohibited.prohibited) {
    add("prohibited_category", "Prohibited category", "fail", prohibited.reason ?? "Prohibited category", 0);
  } else {
    add("prohibited_category", "Prohibited category", "pass", "No prohibited category signal", 6);
  }

  if (restrictedHit) {
    add(
      "restricted",
      "Restricted category",
      "fail",
      `The product matches the restricted term "${restrictedHit}"`,
      0,
    );
  } else {
    add("restricted", "Restricted category", "pass", "No restricted category signal", 10);
  }


  const category = (item.category ?? "").toLowerCase();
  if (category && rules.blocked_categories.some((b) => category.includes(b.toLowerCase()))) {
    add("category_blocked", "Category policy", "fail", "That category is blocked by policy", 0);
  } else if (
    rules.allowed_categories.length > 0 &&
    !rules.allowed_categories.some((a) => category.includes(a.toLowerCase()))
  ) {
    add("category_allowed", "Category policy", "fail", "That category is not in the allowed list", 0);
  } else {
    add("category_allowed", "Category policy", "pass", category || "No category reported", 8);
  }

  if (item.imageUrl) {
    add("imagery", "Imagery", "pass", "A supplier image is available", 10);
  } else if (rules.require_image) {
    add("imagery", "Imagery", "fail", "No supplier image is available", 0);
  } else {
    add("imagery", "Imagery", "warn", "No supplier image is available", 0);
  }

  if (item.inventory === null) {
    add("stock", "Availability", "warn", "The supplier did not report stock", 4);
  } else if (item.inventory > 0) {
    add("stock", "Availability", "pass", `${item.inventory} reported in stock`, 12);
  } else if (rules.require_stock) {
    add("stock", "Availability", "fail", "The supplier reports no available stock", 0);
  } else {
    add("stock", "Availability", "warn", "No available stock reported", 0);
  }

  const deliverable = input.shippingCost !== null;
  if (deliverable) {
    add(
      "uk_delivery",
      "UK deliverability",
      "pass",
      `Shipping to ${settings.shipping_market} quoted at ${input.shippingCost}`,
      15,
    );
  } else if (rules.require_uk_shipping) {
    add(
      "uk_delivery",
      "UK deliverability",
      "fail",
      `Shipping to ${settings.shipping_market} could not be confirmed`,
      0,
    );
  } else {
    add("uk_delivery", "UK deliverability", "warn", "Destination shipping is unconfirmed", 0);
  }

  const variantCount = item.variants.length;
  if (rules.max_variant_count !== null && rules.max_variant_count !== undefined && variantCount > rules.max_variant_count) {
    add(
      "variants",
      "Variant sanity",
      "fail",
      `${variantCount} variants exceeds the configured maximum of ${rules.max_variant_count}`,
      0,
    );
  } else if (variantCount > 40) {
    add("variants", "Variant sanity", "warn", `${variantCount} variants is unusually high`, 2);
  } else {
    add("variants", "Variant sanity", "pass", `${variantCount || 1} variant(s)`, 6);
  }

  const pricing = computePricing({
    supplierCost: input.supplierCost,
    shippingCost: input.shippingCost,
    suggestedRetail: input.suggestedRetail,
    settings,
  });

  if (!pricing.complete) {
    add("pricing", "Pricing completeness", "fail", pricing.reason ?? "Pricing is incomplete", 0);
  } else {
    add(
      "pricing",
      "Pricing completeness",
      "pass",
      `Landed ${pricing.landedCost} priced at ${pricing.price}`,
      15,
    );

    const landed = pricing.landedCost ?? 0;
    const price = pricing.price ?? 0;
    if (rules.min_landed_cost !== null && landed < rules.min_landed_cost) {
      add("landed_min", "Landed cost floor", "fail", "Landed cost is below the configured minimum", 0);
    } else if (rules.max_landed_cost !== null && landed > rules.max_landed_cost) {
      add("landed_max", "Landed cost ceiling", "fail", "Landed cost is above the configured maximum", 0);
    } else {
      add("landed_band", "Landed cost band", "pass", `Landed cost ${landed}`, 6);
    }

    if (rules.min_retail_price !== null && rules.min_retail_price !== undefined && price < rules.min_retail_price) {
      add(
        "retail_min",
        "Commercial viability",
        "fail",
        "The calculated retail price is below the configured minimum",
        0,
      );
    } else if (rules.max_retail_price !== null && price > rules.max_retail_price) {
      add(
        "retail_max",
        "Commercial viability",
        "fail",
        "The calculated retail price is above the configured maximum",
        0,
      );
    } else {
      add("retail_band", "Commercial viability", "pass", `Retail ${price}`, 8);
    }

    if (pricing.promoWithinFloor) {
      add("promo", "Promotional headroom", "pass", "A promotion still clears the margin floor", 10);
    } else {
      add(
        "promo",
        "Promotional headroom",
        "warn",
        "A promotion at the configured discount would fall below the margin floor",
        0,
      );
    }
  }

  if (input.duplicateReason) {
    add("duplicate", "Duplicate control", "fail", input.duplicateReason, 0);
  } else if (rules.duplicate_precheck) {
    add("duplicate", "Duplicate control", "pass", "No matching catalogue product was found", 10);
  } else {
    add("duplicate", "Duplicate control", "warn", "Duplicate pre-check is switched off", 0);
  }

  const failed = reasons.some((reason) => reason.outcome === "fail");
  const threshold = rules.min_suitability_score ?? 60;
  const outcome: ScreenOutcome = failed
    ? "held"
    : score >= threshold
      ? "recommended"
      : "eligible";

  return {
    outcome,
    score,
    reasons,
    landedCost: pricing.landedCost,
    price: pricing.price,
    grossMargin: pricing.grossMargin,
    promoWithinFloor: pricing.promoWithinFloor,
    blockingReason: blocking,
  };
}

export const BATCH_PRESETS = [25, 50, 100, 250, 500] as const;
