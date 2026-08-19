import { createHash } from "crypto";
import {
  MARKETPLACE_NAME,
  enforceMarketplaceIdentity,
  isMarketplaceName,
  resolveProductBrand,
  type IdentityFinding,
} from "./marketplace-identity";


/**
 * Deterministic half of the intelligence layer.
 *
 * Hashes, quality scoring, validators, duplicate detection and schema assembly
 * are all plain code. The semantic model is only ever asked for judgement that
 * genuinely needs language understanding, and everything it returns is checked
 * here before anything reaches the storefront.
 */

export interface ProductRow {
  id: string;
  handle: string;
  title: string;
  description: string | null;
  description_html: string | null;
  product_type: string | null;
  vendor: string | null;
  tags: string[] | null;
  options: unknown;
  featured_image_url: string | null;
  price_min: number | null;
  price_max: number | null;
  currency: string | null;
  available_for_sale: boolean | null;
  total_inventory: number | null;
  variant_count: number | null;
  seo_title: string | null;
  seo_description: string | null;
  status: string | null;
  shopify_updated_at: string | null;
}

export interface ProductBundle {
  product: ProductRow;
  media: Array<{ url: string; alt_text: string | null }>;
  variants: Array<{
    title: string;
    price: number | null;
    available_for_sale: boolean | null;
    selected_options: unknown;
    sku: string | null;
    barcode?: string | null;
  }>;
  collections: Array<{ handle: string; title: string }>;
}

export function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 40);
}

function stableJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([key, item]) => `${key}:${stableJson(item)}`).join(",")}}`;
  }
  return String(value);
}

/**
 * Content fingerprint. Deliberately excludes price and stock so a routine
 * repricing or inventory movement never triggers a model run.
 */
export function contentFingerprint(bundle: ProductBundle): string {
  const { product } = bundle;
  return sha(
    stableJson({
      title: product.title,
      description: product.description ?? product.description_html ?? "",
      product_type: product.product_type,
      vendor: product.vendor,
      tags: [...(product.tags ?? [])].sort(),
      options: product.options,
      media: bundle.media.map((item) => `${item.url}|${item.alt_text ?? ""}`).sort(),
      variants: bundle.variants.map((item) => `${item.title}|${stableJson(item.selected_options)}`).sort(),
      collections: bundle.collections.map((item) => item.handle).sort(),
    }),
  );
}

/** Facts fingerprint covers the commercial values that refresh offer data only. */
export function factsFingerprint(bundle: ProductBundle): string {
  const { product } = bundle;
  return sha(
    stableJson({
      price_min: product.price_min,
      price_max: product.price_max,
      currency: product.currency,
      available: product.available_for_sale,
      inventory: product.total_inventory,
      status: product.status,
    }),
  );
}

/* ------------------------------------------------------------------ */
/* Merchandising quality                                               */
/* ------------------------------------------------------------------ */

export interface QualityAssessment {
  score: number;
  issues: Array<{ code: string; label: string; severity: "info" | "warning" }>;
}

const SUPPLIER_COPY_MARKERS = [
  /\bdropship/i,
  /\bali\s?express\b/i,
  /\bfree shipping worldwide\b/i,
  /\bhot sale\b/i,
  /\bnew arrival 20\d\d\b/i,
  /\bpackage includes?\s*:\s*1\s*x\b/i,
];

export function assessQuality(bundle: ProductBundle): QualityAssessment {
  const { product } = bundle;
  const issues: QualityAssessment["issues"] = [];
  let score = 100;

  const title = product.title?.trim() ?? "";
  const description = (product.description ?? "").replace(/\s+/g, " ").trim();

  if (title.length < 12) {
    issues.push({ code: "title_short", label: "The supplier title is very short.", severity: "warning" });
    score -= 15;
  }
  if (title.length > 110) {
    issues.push({ code: "title_long", label: "The supplier title is overlong for a listing.", severity: "info" });
    score -= 5;
  }
  if (/[A-Z]{6,}/.test(title) || (title === title.toUpperCase() && title.length > 8)) {
    issues.push({ code: "title_shouting", label: "The title uses heavy capitalisation.", severity: "info" });
    score -= 5;
  }
  if (/[|/]{1}.*[|/]{1}/.test(title) || title.split(",").length > 4) {
    issues.push({
      code: "title_keyword_dump",
      label: "The title looks like a supplier keyword list.",
      severity: "warning",
    });
    score -= 10;
  }

  if (description.length < 120) {
    issues.push({
      code: "weak_description",
      label: "Supplier copy is too thin to describe the product properly.",
      severity: "warning",
    });
    score -= 20;
  }
  if (SUPPLIER_COPY_MARKERS.some((pattern) => pattern.test(description))) {
    issues.push({
      code: "supplier_boilerplate",
      label: "Supplier boilerplate wording was detected in the description.",
      severity: "warning",
    });
    score -= 10;
  }

  if (bundle.media.length === 0 && !product.featured_image_url) {
    issues.push({ code: "no_imagery", label: "No product imagery is available.", severity: "warning" });
    score -= 25;
  } else if (bundle.media.length < 2) {
    issues.push({ code: "thin_imagery", label: "Only one image is available.", severity: "info" });
    score -= 5;
  }
  if (bundle.media.some((item) => !item.url || !/^https?:\/\//i.test(item.url))) {
    issues.push({ code: "broken_media", label: "An image reference is not a usable link.", severity: "warning" });
    score -= 10;
  }
  if (bundle.media.length > 0 && bundle.media.every((item) => !item.alt_text?.trim())) {
    issues.push({ code: "missing_alt", label: "No supplier alt text is present on imagery.", severity: "info" });
    score -= 5;
  }

  if (!product.product_type?.trim()) {
    issues.push({ code: "missing_supplier_type", label: "The supplier sent no product type.", severity: "info" });
    score -= 5;
  }
  if ((product.tags ?? []).length === 0) {
    issues.push({ code: "missing_tags", label: "The supplier sent no tags.", severity: "info" });
    score -= 3;
  }
  if (bundle.variants.length === 0) {
    issues.push({ code: "no_variants", label: "No purchasable variant is mirrored.", severity: "warning" });
    score -= 10;
  }

  return { score: Math.max(0, Math.min(100, score)), issues };
}

/* ------------------------------------------------------------------ */
/* Duplicate detection                                                 */
/* ------------------------------------------------------------------ */

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "your", "our", "a", "an", "of", "to", "in", "on",
  "new", "hot", "pcs", "pc", "set", "kit", "portable", "professional", "premium",
]);

export function titleTokens(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2 && !STOP_WORDS.has(token)),
  );
}

export function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / new Set([...a, ...b]).size;
}

/** Near duplicate suspects inside the mirrored catalogue. */
export function findDuplicates(
  rows: Array<{ id: string; title: string }>,
  threshold = 0.72,
): Array<{ id: string; duplicateOf: string; score: number }> {
  const tokenised = rows.map((row) => ({ id: row.id, tokens: titleTokens(row.title) }));
  const results: Array<{ id: string; duplicateOf: string; score: number }> = [];
  for (let i = 0; i < tokenised.length; i += 1) {
    for (let j = i + 1; j < tokenised.length; j += 1) {
      const score = similarity(tokenised[i]!.tokens, tokenised[j]!.tokens);
      if (score >= threshold) {
        results.push({ id: tokenised[j]!.id, duplicateOf: tokenised[i]!.id, score });
      }
    }
  }
  return results;
}

/* ------------------------------------------------------------------ */
/* Search intelligence validation                                      */
/* ------------------------------------------------------------------ */

export interface SeoDraft {
  seo_title: string;
  meta_description: string;
  slug_recommendation: string;
  primary_topic: string;
  entities: string[];
  keywords: string[];
  image_alt: string;
  og_title: string;
  og_description: string;
  faqs: Array<{ question: string; answer: string }>;
  internal_links: Array<{ anchor_text: string; target_type: string; target_reference: string }>;
  collection_relevance: Array<{ handle: string; relevance: string }>;
  /** Long form description broken into useful headings. */
  description_sections: Array<{ heading: string; body: string }>;
  /** Plain entity and context paragraph for answer and assistant engines. */
  entity_summary: string;
}


export interface ValidationIssue {
  code: string;
  label: string;
  severity: "error" | "warning";
}

/**
 * Claim wording that cannot be supported by mirrored catalogue data. Anything
 * matching is stripped rather than published, because the platform must never
 * assert a certification, medical outcome or guarantee the supplier did not
 * genuinely provide.
 */
const UNSUPPORTED_CLAIM_PATTERNS: Array<{ pattern: RegExp; code: string }> = [
  { pattern: /\b(fda|ce|ukca|rohs)\s*(approved|certified|certification)\b/i, code: "claim_certification" },
  { pattern: /\bclinically (proven|tested)\b/i, code: "claim_clinical" },
  { pattern: /\b(cures?|treats?|heals?|prevents?)\s+\w+/i, code: "claim_medical" },
  { pattern: /\b(guarantee[ds]?|lifetime warranty|money back)\b/i, code: "claim_guarantee" },
  { pattern: /\b(best|number one|no\.?\s?1|world'?s leading|top rated)\b/i, code: "claim_superlative" },
  { pattern: /\b\d+(\.\d+)?\s*(stars?|\/5)\b/i, code: "claim_rating" },
  { pattern: /\b(free|next day|same day|24 hour)\s+(delivery|shipping)\b/i, code: "claim_delivery" },
  { pattern: /\b100%\s+\w+/i, code: "claim_absolute" },
];

export function detectUnsupportedClaims(text: string): string[] {
  return UNSUPPORTED_CLAIM_PATTERNS.filter((rule) => rule.pattern.test(text)).map((rule) => rule.code);
}

/**
 * Flags a phrase repeated far beyond natural density in prose. Thresholds are
 * deliberately density based: a short title plus a meta description naturally
 * repeats the product noun two or three times, and treating that as stuffing
 * rejected most of the catalogue.
 */
export function detectKeywordStuffing(text: string): boolean {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !STOP_WORDS.has(word));
  if (words.length < 12) return false;
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  const highest = Math.max(...counts.values());
  return highest / words.length > 0.28 || highest >= 6;
}

/**
 * A keyword list shares a head term by design. Only an almost total repeat of
 * one token across a long list is worth flagging, and only as a warning.
 */
export function detectKeywordListStuffing(keywords: string[]): boolean {
  const cleaned = keywords.map((item) => item.toLowerCase().trim()).filter(Boolean);
  if (cleaned.length < 6) return false;
  const counts = new Map<string, number>();
  for (const phrase of cleaned) {
    for (const token of new Set(phrase.split(/\s+/).filter((word) => word.length > 3 && !STOP_WORDS.has(word)))) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  if (counts.size === 0) return false;
  return Math.max(...counts.values()) / cleaned.length >= 0.9;
}


export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}

export interface SeoValidationContext {
  bundle: ProductBundle;
  /** Titles and descriptions already in use by other products. */
  usedTitles: Map<string, string>;
  usedDescriptions: Map<string, string>;
  validProductHandles: Set<string>;
  validCollectionHandles: Set<string>;
  validArticleSlugs: Set<string>;
}

export interface SeoValidationResult {
  draft: SeoDraft;
  issues: ValidationIssue[];
  score: number;
  state: "valid" | "needs_attention" | "rejected";
}

/**
 * Cleans and checks a generated draft. Anything unsafe is removed rather than
 * published, and hard failures stop the draft reaching the storefront.
 */
export function validateSeoDraft(
  raw: Partial<SeoDraft>,
  context: SeoValidationContext,
): SeoValidationResult {
  const { bundle } = context;
  const product = bundle.product;
  const issues: ValidationIssue[] = [];

  const text = (value: unknown, max: number): string =>
    typeof value === "string" ? value.replace(/\s+/g, " ").replace(/[—–]/g, "-").trim().slice(0, max) : "";

  const list = (value: unknown, max: number, itemMax = 80): string[] =>
    Array.isArray(value)
      ? [
          ...new Set(
            value
              .filter((item): item is string => typeof item === "string")
              .map((item) => item.replace(/\s+/g, " ").trim().slice(0, itemMax))
              .filter(Boolean),
          ),
        ].slice(0, max)
      : [];

  const draft: SeoDraft = {
    seo_title: text(raw.seo_title, 60),
    meta_description: text(raw.meta_description, 158),
    slug_recommendation: slugify(text(raw.slug_recommendation, 90) || product.handle),
    primary_topic: text(raw.primary_topic, 90),
    entities: list(raw.entities, 8),
    keywords: list(raw.keywords, 10),
    image_alt: text(raw.image_alt, 125),
    og_title: text(raw.og_title, 70) || text(raw.seo_title, 70),
    og_description: text(raw.og_description, 200) || text(raw.meta_description, 200),
    faqs: [],
    internal_links: [],
    collection_relevance: [],
    description_sections: [],
    entity_summary: text(raw.entity_summary, 900),
  };

  if (Array.isArray(raw.description_sections)) {
    draft.description_sections = raw.description_sections
      .filter(
        (item): item is { heading: string; body: string } =>
          Boolean(item) && typeof (item as any).heading === "string" && typeof (item as any).body === "string",
      )
      .map((item) => ({ heading: text(item.heading, 90), body: text(item.body, 900) }))
      .filter((item) => item.heading && item.body.length > 40)
      .slice(0, 6);
  }


  if (Array.isArray(raw.faqs)) {
    draft.faqs = raw.faqs
      .filter(
        (item): item is { question: string; answer: string } =>
          Boolean(item) && typeof (item as any).question === "string" && typeof (item as any).answer === "string",
      )
      .map((item) => ({ question: text(item.question, 160), answer: text(item.answer, 500) }))
      .filter((item) => item.question && item.answer)
      .slice(0, 6);
  }

  if (Array.isArray(raw.internal_links)) {
    draft.internal_links = raw.internal_links
      .filter((item): item is SeoDraft["internal_links"][number] => Boolean(item) && typeof item === "object")
      .map((item) => ({
        anchor_text: text((item as any).anchor_text, 90),
        target_type: text((item as any).target_type, 20).toLowerCase(),
        target_reference: text((item as any).target_reference, 120),
      }))
      .filter((item) => item.anchor_text && item.target_reference)
      .slice(0, 8);
  }

  if (Array.isArray(raw.collection_relevance)) {
    draft.collection_relevance = raw.collection_relevance
      .filter((item): item is SeoDraft["collection_relevance"][number] => Boolean(item) && typeof item === "object")
      .map((item) => ({
        handle: text((item as any).handle, 120),
        relevance: text((item as any).relevance, 200),
      }))
      .filter((item) => context.validCollectionHandles.has(item.handle))
      .slice(0, 6);
  }

  // Required fields.
  if (!draft.seo_title) issues.push({ code: "missing_title", label: "No search title was produced.", severity: "error" });
  if (!draft.meta_description) {
    issues.push({ code: "missing_description", label: "No meta description was produced.", severity: "error" });
  }
  if (draft.seo_title && draft.seo_title.length < 15) {
    issues.push({ code: "title_too_short", label: "The search title is too short to be useful.", severity: "warning" });
  }
  if (draft.meta_description && draft.meta_description.length < 70) {
    issues.push({
      code: "description_too_short",
      label: "The meta description is shorter than a useful snippet.",
      severity: "warning",
    });
  }

  // Duplicate metadata across the catalogue.
  const titleOwner = context.usedTitles.get(draft.seo_title.toLowerCase());
  if (draft.seo_title && titleOwner && titleOwner !== product.id) {
    issues.push({ code: "duplicate_title", label: "Another product already uses this search title.", severity: "error" });
  }
  const descriptionOwner = context.usedDescriptions.get(draft.meta_description.toLowerCase());
  if (draft.meta_description && descriptionOwner && descriptionOwner !== product.id) {
    issues.push({
      code: "duplicate_description",
      label: "Another product already uses this meta description.",
      severity: "error",
    });
  }

  // Marketplace identity. Every generated string is corrected before anything
  // else looks at it, so a saved record can never call the platform a maker.
  const identityFindings: IdentityFinding[] = [];
  let identityBlocked = false;
  const guard = (value: string): string => {
    const outcome = enforceMarketplaceIdentity(value);
    identityFindings.push(...outcome.findings);
    if (outcome.blocked) identityBlocked = true;
    return outcome.text;
  };
  draft.seo_title = guard(draft.seo_title).slice(0, 60);
  draft.meta_description = guard(draft.meta_description).slice(0, 158);
  draft.og_title = guard(draft.og_title).slice(0, 70);
  draft.og_description = guard(draft.og_description).slice(0, 200);
  draft.image_alt = guard(draft.image_alt).slice(0, 125);
  draft.primary_topic = guard(draft.primary_topic).slice(0, 90);
  draft.entity_summary = guard(draft.entity_summary).slice(0, 900);
  draft.faqs = draft.faqs.map((item) => ({ question: guard(item.question), answer: guard(item.answer) }));
  draft.description_sections = draft.description_sections.map((item) => ({
    heading: guard(item.heading),
    body: guard(item.body),
  }));
  // Entities and keywords must never carry the marketplace as a brand token.
  draft.entities = draft.entities.filter((item) => !isMarketplaceName(item));
  draft.keywords = draft.keywords.filter((item) => !isMarketplaceName(item));

  const seenIdentity = new Set<string>();
  for (const finding of identityFindings) {
    const key = `${finding.code}:${finding.severity}`;
    if (seenIdentity.has(key)) continue;
    seenIdentity.add(key);
    issues.push({ code: finding.code, label: finding.label, severity: finding.severity });
  }
  if (identityBlocked) {
    issues.push({
      code: "marketplace_identity_violation",
      label: "Wording still presented the marketplace as the maker of the product.",
      severity: "error",
    });
  }

  // Unsupported claims anywhere in the generated wording.
  const combined = [
    draft.seo_title,
    draft.meta_description,
    draft.og_title,
    draft.og_description,
    draft.image_alt,
    draft.entity_summary,
    ...draft.description_sections.flatMap((item) => [item.heading, item.body]),
    ...draft.faqs.flatMap((item) => [item.question, item.answer]),
  ].join(" \n ");
  const claims = detectUnsupportedClaims(combined);
  if (claims.length > 0) {
    // Remove the offending long form blocks rather than publishing them, then
    // re-check what is left so a single bad FAQ does not lose the whole record.
    draft.faqs = draft.faqs.filter(
      (item) => detectUnsupportedClaims(`${item.question} ${item.answer}`).length === 0,
    );
    draft.description_sections = draft.description_sections.filter(
      (item) => detectUnsupportedClaims(`${item.heading} ${item.body}`).length === 0,
    );
    if (detectUnsupportedClaims(draft.entity_summary).length > 0) draft.entity_summary = "";
    const remaining = detectUnsupportedClaims(
      [draft.seo_title, draft.meta_description, draft.og_title, draft.og_description, draft.image_alt].join(" \n "),
    );
    for (const code of remaining) {
      issues.push({ code, label: "Generated wording contained a claim the catalogue cannot support.", severity: "error" });
    }
    for (const code of claims.filter((item) => !remaining.includes(item))) {
      issues.push({
        code,
        label: "An unsupported claim was removed from the long form content before saving.",
        severity: "warning",
      });
    }
  }

  // Keyword stuffing. Prose only: a keyword list naturally shares a head term,
  // so it is checked separately and never rejects an otherwise sound record.
  if (detectKeywordStuffing(`${draft.seo_title} ${draft.meta_description}`)) {
    issues.push({ code: "keyword_stuffing", label: "The wording repeats a term unnaturally.", severity: "error" });
  }
  if (detectKeywordListStuffing(draft.keywords)) {
    issues.push({
      code: "keyword_list_repetitive",
      label: "The keyword list repeats one term in nearly every entry.",
      severity: "warning",
    });
  }


  // Internal links must resolve to something real.
  draft.internal_links = draft.internal_links.filter((link) => {
    if (link.target_type === "product") return context.validProductHandles.has(link.target_reference);
    if (link.target_type === "collection") return context.validCollectionHandles.has(link.target_reference);
    if (link.target_type === "article") return context.validArticleSlugs.has(link.target_reference);
    return false;
  });

  // Factual contradiction guard against the mirrored record.
  if (product.currency && /\b(gbp|usd|eur|£|\$|€)\b/i.test(draft.meta_description)) {
    issues.push({
      code: "price_in_metadata",
      label: "Price wording does not belong in metadata because it changes at the store.",
      severity: "warning",
    });
    draft.meta_description = draft.meta_description.replace(/[£$€]\s?\d[\d.,]*/g, "").replace(/\s{2,}/g, " ").trim();
  }
  if (/\bin stock\b|\bavailable now\b/i.test(combined) && product.available_for_sale !== true) {
    issues.push({
      code: "availability_contradiction",
      label: "Generated wording asserted availability the catalogue does not confirm.",
      severity: "error",
    });
  }

  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.length - errors;
  const score = Math.max(0, 100 - errors * 30 - warnings * 8);
  const state: SeoValidationResult["state"] = errors > 0 ? "rejected" : warnings > 0 ? "needs_attention" : "valid";

  return { draft, issues, score, state };
}

/* ------------------------------------------------------------------ */
/* Schema assembly                                                     */
/* ------------------------------------------------------------------ */

/**
 * Product schema inputs. Only mirrored, verified commercial facts are used.
 * No rating, review, GTIN or delivery claim is ever assembled here.
 */
export function buildProductSchemaInputs(
  bundle: ProductBundle,
  extras: { description: string | null; categoryPath: string[]; canonicalPath: string },
): Record<string, unknown> {
  const { product } = bundle;
  const images = [product.featured_image_url, ...bundle.media.map((item) => item.url)].filter(
    (url): url is string => Boolean(url),
  );

  const offers: Record<string, unknown> = {};
  if (product.price_min != null && product.currency) {
    offers["@type"] = product.price_min === product.price_max ? "Offer" : "AggregateOffer";
    offers["priceCurrency"] = product.currency;
    if (product.price_min === product.price_max) {
      offers["price"] = product.price_min;
    } else {
      offers["lowPrice"] = product.price_min;
      offers["highPrice"] = product.price_max;
      offers["offerCount"] = bundle.variants.length || product.variant_count || 1;
    }
    if (product.available_for_sale != null) {
      offers["availability"] = product.available_for_sale
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock";
    }
  }

  const schema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    url: extras.canonicalPath,
  };
  if (extras.description) schema["description"] = extras.description;
  if (images.length > 0) schema["image"] = [...new Set(images)].slice(0, 6);
  // Brand, manufacturer, supplier and marketplace stay separate. The store
  // vendor value is the marketplace itself, so it never becomes a brand claim.
  const identity = resolveProductBrand({ vendor: product.vendor });
  if (identity.brand) schema["brand"] = { "@type": "Brand", name: identity.brand };
  if (identity.manufacturer) schema["manufacturer"] = { "@type": "Organization", name: identity.manufacturer };
  schema["seller"] = { "@type": "Organization", name: MARKETPLACE_NAME };

  if (extras.categoryPath.length > 0) schema["category"] = extras.categoryPath.join(" > ");
  if (Object.keys(offers).length > 0) schema["offers"] = offers;

  return schema;
}

export function buildBreadcrumbInputs(
  trail: Array<{ name: string; path: string }>,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.path,
    })),
  };
}
