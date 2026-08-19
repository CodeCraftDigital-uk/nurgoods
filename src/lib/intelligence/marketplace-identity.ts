/**
 * Marketplace identity guard.
 *
 * NUR GOODS is a marketplace and retail platform. It does not manufacture,
 * own-brand, make, invent, design or produce anything it lists. Supplier feeds
 * set the Shopify vendor field to the store name, so both the generation
 * prompt and this deterministic layer have to keep four ideas apart:
 *
 *   brand         the product brand, only when a trusted source states it
 *   manufacturer  who made it, only when a trusted source states it
 *   supplier      the fulfilment source, never customer facing wording
 *   marketplace   NUR GOODS, the seller of record
 *
 * Nothing generated may reach a saved record until it has been through
 * enforceMarketplaceIdentity.
 */

export const MARKETPLACE_NAME = "NUR GOODS";

/** Spellings that all mean the marketplace itself rather than a product brand. */
const MARKETPLACE_ALIASES = ["nur goods", "nurgoods", "nur-goods", "nur good"];

export function isMarketplaceName(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalised = value.toLowerCase().replace(/\s+/g, " ").trim();
  return MARKETPLACE_ALIASES.includes(normalised);
}

export interface ResolvedBrand {
  /** The product brand when a trusted source genuinely evidenced one. */
  brand: string | null;
  /** The manufacturer when a trusted source genuinely evidenced one. */
  manufacturer: string | null;
  /** True when the vendor value is the marketplace and carries no brand meaning. */
  vendorIsMarketplace: boolean;
}

/**
 * Turns raw catalogue fields into brand and manufacturer facts. A vendor value
 * of NUR GOODS is a storefront ownership value, never a maker, so it is
 * deliberately discarded rather than promoted into a brand claim.
 */
export function resolveProductBrand(input: {
  vendor?: string | null;
  brand?: string | null;
  manufacturer?: string | null;
  /** Optional catalogue tags, scanned only for an explicit brand: prefix. */
  tags?: string[] | null;
  /** Optional metafield map, scanned only for explicit brand keys. */
  metafields?: Record<string, unknown> | null;
}): ResolvedBrand {

  const vendorIsMarketplace = isMarketplaceName(input.vendor);
  const clean = (value: string | null | undefined): string | null => {
    const trimmed = (value ?? "").replace(/\s+/g, " ").trim();
    if (!trimmed) return null;
    if (isMarketplaceName(trimmed)) return null;
    if (/^(unbranded|no brand|generic|n\/?a|none|unknown)$/i.test(trimmed)) return null;
    return trimmed;
  };

  const explicitBrand = clean(input.brand);
  const vendorBrand = vendorIsMarketplace ? null : clean(input.vendor);
  return {
    brand: explicitBrand ?? vendorBrand,
    manufacturer: clean(input.manufacturer),
    vendorIsMarketplace,
  };
}

export interface IdentityFinding {
  code: string;
  label: string;
  severity: "error" | "warning";
  excerpt: string;
}

const NUR = String.raw`nur\s*-?\s*goods`;
const MAKE_VERBS = "manufactures?|manufactured|makes?|made|produces?|produced|designs?|designed|crafts?|crafted|creates?|created|invents?|invented|engineers?|engineered|develops?|developed|builds?|built|formulates?|formulated";

/**
 * Rewrites, in priority order. Each rule turns a maker claim into accurate
 * marketplace wording rather than deleting the sentence, so useful copy
 * survives the correction.
 */
const REWRITES: Array<{ code: string; label: string; pattern: RegExp; replacement: string }> = [
  {
    code: "identity_made_by",
    label: "Wording said the marketplace made or designed the product.",
    pattern: new RegExp(
      String.raw`\b(?:${MAKE_VERBS})\s+(?:exclusively\s+|specially\s+|in[-\s]house\s+)?(?:by|for|at)\s+${NUR}\b`,
      "gi",
    ),
    replacement: `available from ${MARKETPLACE_NAME}`,
  },
  {
    code: "identity_marketplace_makes",
    label: "Wording said the marketplace manufactures the product.",
    pattern: new RegExp(String.raw`\b${NUR}\s+(?:${MAKE_VERBS})\b`, "gi"),
    replacement: `${MARKETPLACE_NAME} sells`,
  },
  {
    code: "identity_own_brand",
    label: "Wording described an own brand or private label range.",
    pattern: new RegExp(
      String.raw`\b${NUR}(?:['’]s)?\s+(?:own\s+|in[-\s]house\s+|private[-\s]label\s+|signature\s+|exclusive\s+)?(?:brand|label|private label|own[-\s]brand)\b`,
      "gi",
    ),
    replacement: MARKETPLACE_NAME,
  },
  {
    code: "identity_branded",
    label: "Wording described the item as marketplace branded.",
    pattern: new RegExp(String.raw`\b${NUR}[-\s]branded\b`, "gi"),
    replacement: `available from ${MARKETPLACE_NAME}`,
  },
  {
    code: "identity_brand_attribution",
    label: "Wording attributed the product to the marketplace as its brand.",
    pattern: new RegExp(String.raw`\bbrand\s*[:\-]\s*${NUR}\b`, "gi"),
    replacement: `sold through ${MARKETPLACE_NAME}`,
  },
  {
    code: "identity_by_marketplace",
    label: "Wording credited the product to the marketplace with by.",
    pattern: new RegExp(String.raw`\bby\s+${NUR}\b`, "gi"),
    replacement: `from ${MARKETPLACE_NAME}`,
  },
  {
    code: "identity_first_person_maker",
    label: "Wording claimed the platform itself makes the product.",
    pattern: new RegExp(
      String.raw`\bwe\s+(?:manufacture|make|produce|design|craft|invent|engineer|formulate|build)\b`,
      "gi",
    ),
    replacement: "we sell",
  },
  {
    code: "identity_our_own_brand",
    label: "Wording described the product as the platform's own brand.",
    pattern: /\bour\s+(?:own\s+)?(?:brand|label|private label)\b/gi,
    replacement: "our marketplace",
  },
];

/** Residual maker wording that no rewrite could safely repair. */
const RESIDUAL_PATTERNS: Array<{ code: string; label: string; pattern: RegExp }> = [
  {
    code: "identity_residual_maker",
    label: "Maker wording about the marketplace remained after correction.",
    pattern: new RegExp(
      String.raw`${NUR}[^.!?]{0,60}\b(?:manufactur\w*|own brand|private label|in[-\s]house|our factory)\b`,
      "i",
    ),
  },
  {
    code: "identity_residual_maker",
    label: "Maker wording about the marketplace remained after correction.",
    pattern: new RegExp(String.raw`\b(?:manufactur\w*|produced|invented)\b[^.!?]{0,40}${NUR}`, "i"),
  },
];

export interface IdentityEnforcement {
  text: string;
  changed: boolean;
  findings: IdentityFinding[];
  /** True when maker wording survived correction and a person should look. */
  blocked: boolean;
}

/** Corrects marketplace identity wording in a single string. */
export function enforceMarketplaceIdentity(input: string | null | undefined): IdentityEnforcement {
  const original = typeof input === "string" ? input : "";
  let text = original;
  const findings: IdentityFinding[] = [];

  for (const rule of REWRITES) {
    const match = text.match(rule.pattern);
    if (!match) continue;
    findings.push({
      code: rule.code,
      label: rule.label,
      severity: "warning",
      excerpt: match[0].slice(0, 120),
    });
    text = text.replace(rule.pattern, rule.replacement);
  }

  // Tidy the seams a rewrite can leave behind.
  text = text.replace(/\s{2,}/g, " ").replace(/\s+([.,;:!?])/g, "$1").trim();

  let blocked = false;
  for (const rule of RESIDUAL_PATTERNS) {
    const match = text.match(rule.pattern);
    if (!match) continue;
    blocked = true;
    findings.push({ code: rule.code, label: rule.label, severity: "error", excerpt: match[0].slice(0, 120) });
  }

  return { text, changed: text !== original, findings, blocked };
}

/** Convenience detector used by tests and audits. */
export function detectMarketplaceIdentityViolations(text: string): IdentityFinding[] {
  return enforceMarketplaceIdentity(text).findings;
}

/** Prompt language shared by every generation stage that mentions the store. */
export const MARKETPLACE_IDENTITY_RULES = [
  `${MARKETPLACE_NAME} is a marketplace and retail platform only.`,
  `Never describe ${MARKETPLACE_NAME} as the manufacturer, maker, producer, designer, inventor, brand, private label owner or originator of a product.`,
  `There are no ${MARKETPLACE_NAME} manufactured or ${MARKETPLACE_NAME} branded products in this catalogue.`,
  `Acceptable wording is: available from ${MARKETPLACE_NAME}, sold through ${MARKETPLACE_NAME}, available on the ${MARKETPLACE_NAME} marketplace.`,
  "The store vendor field is an ownership value, not a brand. Never turn it into a brand or manufacturer statement.",
  "State a brand or manufacturer only when the supplied product data names one. Otherwise omit it entirely and never guess.",
  "Never invent provenance, country of origin, certifications, materials, dimensions, compatibility, warranties, health or safety outcomes, or performance figures.",
].join(" ");
