/**
 * Shared helpers for legal and policy content imported from the connected
 * store. Pure functions only, safe to import from server and browser code.
 *
 * Two things matter here. Store policy bodies can still contain unresolved
 * Liquid, and owner authored pages can still contain bracketed template
 * placeholders. Neither may ever reach a customer as final legal wording, so
 * both are detected here and used to gate public rendering.
 */

export type LegalSourceType = "shop_policy" | "shopify_page";

export type LegalReviewStatus = "current" | "needs_review" | "unpublished" | "sync_error";

/** Stable public slugs for native store policies. */
export const POLICY_TYPE_SLUGS: Record<string, string> = {
  PRIVACY_POLICY: "privacy-policy",
  REFUND_POLICY: "refund-returns-policy",
  SHIPPING_POLICY: "shipping-and-delivery-policy",
  TERMS_OF_SERVICE: "terms-and-conditions",
  TERMS_OF_SALE: "terms-of-sale",
  LEGAL_NOTICE: "legal-notice",
  SUBSCRIPTION_POLICY: "subscription-policy",
  CONTACT_INFORMATION: "contact-information",
};

/** Friendly titles used only when the store does not supply one. */
export const POLICY_TYPE_TITLES: Record<string, string> = {
  PRIVACY_POLICY: "Privacy Policy",
  REFUND_POLICY: "Refund and Returns Policy",
  SHIPPING_POLICY: "Shipping and Delivery Policy",
  TERMS_OF_SERVICE: "Terms and Conditions",
  TERMS_OF_SALE: "Terms of Sale",
  LEGAL_NOTICE: "Legal Notice",
  SUBSCRIPTION_POLICY: "Subscription Policy",
  CONTACT_INFORMATION: "Contact Information",
};

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Detects unresolved Liquid output and tag syntax. */
export function detectLiquid(body: string): string[] {
  const tokens = new Set<string>();
  const pattern = /\{\{[^}]{0,200}\}\}|\{%[^%]{0,200}%\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    tokens.add(match[0].trim().slice(0, 120));
    if (tokens.size >= 25) break;
  }
  return [...tokens];
}

/** Detects bracketed owner placeholders such as [LEGAL OWNER NAME]. */
export function detectPlaceholders(body: string): string[] {
  const tokens = new Set<string>();
  const bracket = /\[[A-Z0-9][A-Z0-9 _/&.'’-]{2,60}\]/g;
  let match: RegExpExecArray | null;
  while ((match = bracket.exec(body)) !== null) {
    tokens.add(match[0].trim());
    if (tokens.size >= 25) break;
  }
  const phrases = [
    "insert your",
    "add your company",
    "before publishing",
    "replace this",
    "your company name here",
    "lorem ipsum",
  ];
  const lower = body.toLowerCase();
  for (const phrase of phrases) {
    if (lower.includes(phrase)) tokens.add(phrase);
  }
  return [...tokens];
}

/** Rough text length used to spot empty or near empty imported pages. */
export function textLength(html: string): number {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim().length;
}

export interface VisibilityDecision {
  publicVisible: boolean;
  reviewStatus: LegalReviewStatus;
  excludeReason: string | null;
}

/**
 * Decides whether an imported document may be rendered publicly. Anything with
 * unresolved Liquid, owner placeholders, no body or an unpublished state stays
 * private and is surfaced to the admin for correction at the source.
 */
export function decideVisibility(input: {
  isPublished: boolean;
  hasLiquid: boolean;
  hasPlaceholders: boolean;
  bodyLength: number;
  syncError?: string | null;
}): VisibilityDecision {
  if (input.syncError) {
    return { publicVisible: false, reviewStatus: "sync_error", excludeReason: input.syncError };
  }
  if (!input.isPublished) {
    return {
      publicVisible: false,
      reviewStatus: "unpublished",
      excludeReason: "This document is not published in the store.",
    };
  }
  if (input.bodyLength < 200) {
    return {
      publicVisible: false,
      reviewStatus: "needs_review",
      excludeReason:
        "There is too little text to present as a policy. Add the full wording in the store.",
    };
  }
  if (input.hasPlaceholders) {
    return {
      publicVisible: false,
      reviewStatus: "needs_review",
      excludeReason:
        "Unresolved owner placeholders were found. Replace them in the store before this can be shown.",
    };
  }
  if (input.hasLiquid) {
    return {
      publicVisible: false,
      reviewStatus: "needs_review",
      excludeReason:
        "This policy still contains store template variables that only resolve inside the store. Visitors are sent to the store copy instead.",
    };
  }
  return { publicVisible: true, reviewStatus: "current", excludeReason: null };
}

export function reviewStatusLabel(status: string): string {
  switch (status) {
    case "current":
      return "Current";
    case "needs_review":
      return "Needs review";
    case "sync_error":
      return "Sync error";
    case "unpublished":
      return "Unpublished";
    default:
      return status;
  }
}
