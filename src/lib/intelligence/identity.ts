import { createHash } from "crypto";
import { similarity, titleTokens, type ProductBundle } from "./core.server";

/**
 * Deterministic product identity.
 *
 * Everything here is plain code with no model involvement. Identity is proven
 * from the strongest structured evidence the mirrored catalogue carries, and a
 * hard contradiction always wins over a soft resemblance. Two listings are
 * never treated as the same product because their titles look alike.
 */

export const IDENTITY_VERSION = "identity-1";

/** Confidence needed before the presentation layer may hide a listing. */
export const HIGH_CONFIDENCE = 0.9;
/** Confidence worth showing an administrator as a suspect. */
export const SUSPECT_CONFIDENCE = 0.62;
/** Band where a semantic tie breaker is allowed to help. */
export const TIEBREAK_BAND: [number, number] = [0.72, HIGH_CONFIDENCE];

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function norm(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

const GENERIC_SKUS = new Set(["default", "none", "n a", "na", "sku", "0", "1", "test"]);

function normaliseSku(value: string | null | undefined): string | null {
  const cleaned = (value ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, "");
  if (cleaned.length < 4 || cleaned.length > 32) return null;
  if (GENERIC_SKUS.has(cleaned.toLowerCase())) return null;
  if (/^0+$/.test(cleaned)) return null;
  return cleaned;
}

function normaliseBarcode(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D+/g, "");
  if (digits.length < 8 || digits.length > 14) return null;
  if (/^0+$/.test(digits)) return null;
  return digits;
}

/** Manufacturer style codes: mixed letters and digits, or hyphenated blocks. */
function modelCodes(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.match(/\b[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)+\b|\b[A-Za-z]{2,}\d{2,}[A-Za-z0-9]*\b/g) ?? []) {
    const token = raw.toUpperCase().replace(/[^A-Z0-9-]/g, "");
    if (token.length < 5 || token.length > 24) continue;
    if (!/\d/.test(token) || !/[A-Z]/.test(token)) continue;
    if (/^(?:UK|EU|USB|LED|HDMI)$/.test(token)) continue;
    out.add(token);
  }
  return [...out].slice(0, 8);
}

const UNIT_PATTERN =
  /(\d+(?:\.\d+)?)\s*(ml|l|litre|liters?|g|kg|mg|mm|cm|m|inch|in|ft|w|kw|v|mah|wh|gb|tb|mb|pcs|pack|piece|count|ply|micron)\b/gi;

const UNIT_ALIASES: Record<string, string> = {
  litre: "l",
  liter: "l",
  liters: "l",
  in: "inch",
  piece: "pcs",
  count: "pcs",
};

/** Measurable attributes such as capacity, size, wattage and pack size. */
export function attributeTokens(text: string): string[] {
  const out = new Set<string>();
  for (const match of text.matchAll(UNIT_PATTERN)) {
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) continue;
    const rawUnit = (match[2] ?? "").toLowerCase();
    const unit = UNIT_ALIASES[rawUnit] ?? rawUnit;
    out.add(`${unit}:${amount}`);
  }
  return [...out].sort();
}

/** Pack quantity, only when the copy states it plainly. */
export function packQuantity(text: string): number | null {
  const match =
    text.match(/\b(\d{1,3})\s*(?:x|pcs|pieces|pack|packs|count)\b/i) ??
    text.match(/\bpack of\s*(\d{1,3})\b/i) ??
    text.match(/\bset of\s*(\d{1,3})\b/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 && value <= 500 ? value : null;
}

const ACCESSORY_MARKERS = [
  /\bcase\b/i,
  /\bcover\b/i,
  /\bsleeve\b/i,
  /\bstand\b/i,
  /\bmount\b/i,
  /\bstrap\b/i,
  /\brefill\b/i,
  /\breplacement\b/i,
  /\bspare\b/i,
  /\badapter\b/i,
  /\bcharger\b/i,
  /\bcable\b/i,
  /\bbundle\b/i,
  /\bgift set\b/i,
];

export interface IdentitySignals {
  productId: string;
  handle: string;
  title: string;
  vendorKey: string | null;
  barcodes: string[];
  skus: string[];
  modelCodes: string[];
  packQuantity: number | null;
  attributeTokens: string[];
  specSignature: string;
  variantSignature: string;
  imageSignatures: string[];
  accessoryMarkers: string[];
  descriptionHash: string;
  descriptionTokens: Set<string>;
  titleTokens: Set<string>;
  identityFingerprint: string;
}

/** Shopify CDN filenames are shared when suppliers reuse the same asset. */
function imageSignature(url: string): string | null {
  try {
    const path = new URL(url).pathname;
    const base = path.split("/").pop() ?? "";
    const stem = base.replace(/\.[a-z0-9]+$/i, "").replace(/_\d{3,4}x\d{0,4}$/i, "");
    const cleaned = stem.replace(/[^a-z0-9]/gi, "").toLowerCase();
    return cleaned.length >= 8 ? cleaned.slice(0, 40) : null;
  } catch {
    return null;
  }
}

export function extractSignals(bundle: ProductBundle): IdentitySignals {
  const { product } = bundle;
  const description = (product.description ?? product.description_html ?? "").replace(/<[^>]+>/g, " ");
  const haystack = `${product.title} ${description}`;

  const barcodes = [
    ...new Set(
      bundle.variants
        .map((variant) => normaliseBarcode((variant as { barcode?: string | null }).barcode ?? null))
        .filter((value): value is string => Boolean(value)),
    ),
  ].sort();

  const skus = [
    ...new Set(
      bundle.variants
        .map((variant) => normaliseSku(variant.sku))
        .filter((value): value is string => Boolean(value)),
    ),
  ].sort();

  const attributes = attributeTokens(haystack);
  const options = bundle.variants
    .map((variant) => {
      const raw = Array.isArray(variant.selected_options) ? variant.selected_options : [];
      return raw
        .map((option) => {
          const entry = option as { name?: unknown; value?: unknown };
          return `${norm(String(entry.name ?? ""))}=${norm(String(entry.value ?? ""))}`;
        })
        .sort()
        .join("|");
    })
    .sort();

  const images = [
    ...new Set(
      [product.featured_image_url, ...bundle.media.map((item) => item.url)]
        .filter((value): value is string => Boolean(value))
        .map(imageSignature)
        .filter((value): value is string => Boolean(value)),
    ),
  ].sort();

  const signals: IdentitySignals = {
    productId: product.id,
    handle: product.handle,
    title: product.title,
    vendorKey: norm(product.vendor) || null,
    barcodes,
    skus,
    modelCodes: modelCodes(haystack),
    packQuantity: packQuantity(haystack),
    attributeTokens: attributes,
    specSignature: hash(`${attributes.join(",")}|${packQuantity(haystack) ?? ""}`),
    variantSignature: hash(options.join("~")),
    imageSignatures: images,
    accessoryMarkers: ACCESSORY_MARKERS.filter((pattern) => pattern.test(product.title)).map(
      (pattern) => pattern.source.replace(/\\b/g, ""),
    ),
    descriptionHash: hash(norm(description).slice(0, 4000)),
    descriptionTokens: titleTokens(norm(description).slice(0, 2000)),
    titleTokens: titleTokens(product.title),
    identityFingerprint: "",
  };

  signals.identityFingerprint = hash(
    [
      IDENTITY_VERSION,
      barcodes.join(","),
      skus.join(","),
      signals.modelCodes.join(","),
      signals.vendorKey ?? "",
      signals.packQuantity ?? "",
      signals.specSignature,
      signals.variantSignature,
      images.join(","),
      signals.descriptionHash,
      norm(product.title),
    ].join("::"),
  );

  return signals;
}

/* ------------------------------------------------------------------ */
/* Pair comparison                                                     */
/* ------------------------------------------------------------------ */

export interface MatchEvidence {
  code: string;
  label: string;
  weight: number;
  strong: boolean;
}

export interface MatchVeto {
  code: string;
  label: string;
}

export interface PairVerdict {
  score: number;
  tier: "high" | "medium" | "low";
  evidence: MatchEvidence[];
  vetoes: MatchVeto[];
  hasStrongEvidence: boolean;
  needsTieBreak: boolean;
}

function overlap(a: string[], b: string[]): string[] {
  const set = new Set(b);
  return a.filter((value) => set.has(value));
}

function numericConflict(a: string[], b: string[]): string | null {
  const unitsOf = (list: string[]) => {
    const map = new Map<string, Set<string>>();
    for (const token of list) {
      const [unit, value] = token.split(":");
      if (!unit || !value) continue;
      map.set(unit, (map.get(unit) ?? new Set()).add(value));
    }
    return map;
  };
  const left = unitsOf(a);
  const right = unitsOf(b);
  for (const [unit, values] of left) {
    const other = right.get(unit);
    if (!other || other.size === 0) continue;
    const shared = [...values].some((value) => other.has(value));
    if (!shared) return unit;
  }
  return null;
}

/**
 * Compares two products. Structured proof raises confidence; a genuine
 * contradiction removes it entirely.
 */
export function comparePair(a: IdentitySignals, b: IdentitySignals): PairVerdict {
  const evidence: MatchEvidence[] = [];
  const vetoes: MatchVeto[] = [];

  const sharedBarcodes = overlap(a.barcodes, b.barcodes);
  const sharedSkus = overlap(a.skus, b.skus);
  const sharedModels = overlap(a.modelCodes, b.modelCodes);
  const sharedImages = overlap(a.imageSignatures, b.imageSignatures);
  const titleScore = similarity(a.titleTokens, b.titleTokens);
  const descriptionScore = similarity(a.descriptionTokens, b.descriptionTokens);

  if (sharedBarcodes.length > 0) {
    evidence.push({
      code: "barcode",
      label: `Identical supplier barcode (${sharedBarcodes[0]})`,
      weight: 0.96,
      strong: true,
    });
  }
  if (sharedModels.length > 0 && (!a.vendorKey || !b.vendorKey || a.vendorKey === b.vendorKey)) {
    evidence.push({
      code: "model_code",
      label: `Identical manufacturer code (${sharedModels[0]})`,
      weight: 0.82,
      strong: true,
    });
  }
  if (sharedSkus.length > 0) {
    evidence.push({
      code: "sku",
      label: `Identical supplier reference (${sharedSkus[0]})`,
      weight: 0.74,
      strong: true,
    });
  }
  if (sharedImages.length > 0) {
    evidence.push({
      code: "imagery",
      label: `${sharedImages.length} identical supplier image${sharedImages.length === 1 ? "" : "s"}`,
      weight: sharedImages.length > 1 ? 0.72 : 0.58,
      strong: sharedImages.length > 1,
    });
  }
  if (a.variantSignature === b.variantSignature && a.variantSignature) {
    evidence.push({ code: "variants", label: "Identical variant options", weight: 0.34, strong: false });
  }
  if (a.specSignature === b.specSignature && a.attributeTokens.length > 0) {
    evidence.push({ code: "specifications", label: "Identical measurable specifications", weight: 0.34, strong: false });
  }
  if (a.descriptionHash === b.descriptionHash) {
    evidence.push({ code: "description_exact", label: "Identical supplier description", weight: 0.6, strong: false });
  } else if (descriptionScore >= 0.82) {
    evidence.push({ code: "description_similar", label: "Near identical supplier description", weight: 0.3, strong: false });
  }
  if (titleScore >= 0.6) {
    evidence.push({
      code: "title",
      label: `Title similarity ${Math.round(titleScore * 100)} percent`,
      weight: Math.min(0.25, titleScore * 0.25),
      strong: false,
    });
  }

  // Hard contradictions. These describe genuinely different products.
  if (a.packQuantity && b.packQuantity && a.packQuantity !== b.packQuantity) {
    vetoes.push({ code: "pack_quantity", label: "Different pack quantities" });
  }
  const unitConflict = numericConflict(a.attributeTokens, b.attributeTokens);
  if (unitConflict) {
    vetoes.push({ code: `attribute_${unitConflict}`, label: `Different ${unitConflict} specification` });
  }
  const accessoryA = a.accessoryMarkers.join(",");
  const accessoryB = b.accessoryMarkers.join(",");
  if (accessoryA !== accessoryB && sharedBarcodes.length === 0) {
    vetoes.push({ code: "accessory", label: "One listing is an accessory, bundle or companion item" });
  }
  if (a.vendorKey && b.vendorKey && a.vendorKey !== b.vendorKey && sharedBarcodes.length === 0) {
    vetoes.push({ code: "vendor", label: "Different suppliers with no shared identifier" });
  }

  // Combined confidence. Independent evidence compounds, nothing exceeds one.
  const score = Math.min(
    0.99,
    1 - evidence.reduce((product, item) => product * (1 - item.weight), 1),
  );
  const hasStrongEvidence = evidence.some((item) => item.strong);

  let tier: PairVerdict["tier"] = "low";
  if (vetoes.length === 0 && hasStrongEvidence && score >= HIGH_CONFIDENCE) tier = "high";
  else if (score >= SUSPECT_CONFIDENCE) tier = "medium";

  const needsTieBreak =
    tier !== "high" &&
    vetoes.length === 0 &&
    score >= TIEBREAK_BAND[0] &&
    score < TIEBREAK_BAND[1] &&
    hasStrongEvidence;

  return { score, tier, evidence, vetoes, hasStrongEvidence, needsTieBreak };
}

/**
 * Cheap blocking keys. Only products that share at least one key are ever
 * compared, so the matcher stays linear in practice.
 */
export function blockingKeys(signals: IdentitySignals): string[] {
  const keys = new Set<string>();
  for (const barcode of signals.barcodes) keys.add(`b:${barcode}`);
  for (const sku of signals.skus) keys.add(`s:${sku}`);
  for (const model of signals.modelCodes) keys.add(`m:${model}`);
  for (const image of signals.imageSignatures) keys.add(`i:${image}`);
  keys.add(`d:${signals.descriptionHash}`);
  const tokens = [...signals.titleTokens].sort();
  for (const token of tokens.slice(0, 4)) keys.add(`t:${token}`);
  return [...keys];
}
