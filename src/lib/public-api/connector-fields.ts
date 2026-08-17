/**
 * Field allowlisting for the public read only connector surface.
 *
 * The connector must only ever emit merchandising information that is already
 * visible to any anonymous visitor on the public shop. This module is the one
 * place where a full internal product record is narrowed down to that public
 * shape, so the rule can be unit tested in isolation and cannot drift.
 *
 * Nothing here may pass through supplier costs, landed cost workings, margin
 * or pricing formulas, internal scoring or reasoning, duplicate intelligence,
 * raw store payloads, admin notes, credentials or customer and order data.
 */

/** Public product summary as emitted by catalogue search. */
export interface ConnectorProductSummary {
  handle: string;
  title: string;
  summary: string | null;
  category: string | null;
  product_type: string | null;
  brand: string | null;
  tags: string[];
  image_url: string | null;
  price_from: number | null;
  price_to: number | null;
  currency: string | null;
  available: boolean | null;
  variant_count: number;
  product_url: string;
}

export interface ConnectorVariant {
  title: string;
  options: { name: string; value: string }[];
  price: number | null;
  currency: string | null;
  available: boolean | null;
  image_url: string | null;
}

export interface ConnectorProductDetail extends ConnectorProductSummary {
  description: string | null;
  benefits: string[];
  use_cases: string[];
  specifications: { label: string; value: string }[];
  delivery_information: string | null;
  care_information: string | null;
  faqs: { question: string; answer: string }[];
  category_path: string[];
  collections: string[];
  images: { url: string; alt: string | null }[];
  options: { name: string; values: string[] }[];
  variants: ConnectorVariant[];
  last_updated_at: string | null;
}

/**
 * Keys that must never appear anywhere in a connector payload. Used by the
 * projection guard and by the regression tests.
 */
export const FORBIDDEN_KEY_PATTERNS: RegExp[] = [
  /cost/i,
  /margin/i,
  /supplier/i,
  /zendrop/i,
  /vendor_sku/i,
  /raw/i,
  /internal/i,
  /score/i,
  /reason/i,
  /anomaly/i,
  /duplicate/i,
  /suppress/i,
  /token|secret|key|credential/i,
  /shopify_/i,
  /admin/i,
  /customer|order|email/i,
  /checkout_/i,
  /intelligence/i,
  /seo_/i,
  /validation/i,
];

/** True when an object graph contains any key the connector must not emit. */
export function findForbiddenKey(value: unknown, path = ""): string | null {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findForbiddenKey(item, `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
      return path ? `${path}.${key}` : key;
    }
    const found = findForbiddenKey(child, path ? `${path}.${key}` : key);
    if (found) return found;
  }
  return null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function pairs<A extends string, B extends string>(
  value: unknown,
  a: A,
  b: B,
): { [K in A | B]: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Record<string, unknown>;
    if (typeof entry[a] !== "string" || typeof entry[b] !== "string") return [];
    return [{ [a]: entry[a], [b]: entry[b] } as { [K in A | B]: string }];
  });
}

/** Narrows a full internal detail record to the public connector summary. */
export function projectSummary(row: Record<string, unknown>, productUrl: string): ConnectorProductSummary {
  const categoryPath = Array.isArray(row["category_path"])
    ? (row["category_path"] as { name?: unknown }[]).map((c) => text(c?.name)).filter((v): v is string => Boolean(v))
    : [];
  return {
    handle: String(row["handle"] ?? ""),
    title: String(row["title"] ?? ""),
    summary: text(row["summary"]),
    category: categoryPath.length > 0 ? categoryPath[categoryPath.length - 1]! : text(row["category_name"]),
    product_type: text(row["product_type"]),
    brand: text(row["vendor"]),
    tags: strings(row["tags"]),
    image_url: text(row["image_url"]) ?? text(row["featured_image_url"]),
    price_from: num(row["price_min"]),
    price_to: num(row["price_max"]),
    currency: text(row["currency"]),
    available: typeof row["available_for_sale"] === "boolean" ? row["available_for_sale"] : null,
    variant_count: num(row["variant_count"]) ?? 0,
    product_url: productUrl,
  };
}

/** Narrows a full internal detail record to the public connector detail shape. */
export function projectDetail(
  row: Record<string, unknown>,
  productUrl: string,
): ConnectorProductDetail {
  const variantRows = Array.isArray(row["variants"]) ? (row["variants"] as Record<string, unknown>[]) : [];
  const mediaRows = Array.isArray(row["media"]) ? (row["media"] as Record<string, unknown>[]) : [];
  const optionRows = Array.isArray(row["options"]) ? (row["options"] as Record<string, unknown>[]) : [];

  const variants: ConnectorVariant[] = variantRows
    // Options a shopper cannot see are never described to an assistant.
    .filter((v) => v["available_for_sale"] !== false || variantRows.length === 1)
    .map((v) => ({
      title: String(v["title"] ?? ""),
      options: pairs(v["selected_options"], "name", "value"),
      price: num(v["price"]),
      currency: text(v["currency"]) ?? text(row["currency"]),
      available: typeof v["available_for_sale"] === "boolean" ? v["available_for_sale"] : null,
      image_url: text(v["image_url"]),
    }));

  return {
    ...projectSummary(row, productUrl),
    description: text(row["description"]),
    benefits: strings(row["benefits"]),
    use_cases: strings(row["use_cases"]),
    specifications: pairs(row["specifications"], "label", "value"),
    delivery_information: text(row["delivery_information"]),
    care_information: text(row["care_information"]),
    faqs: pairs(row["faqs"], "question", "answer"),
    category_path: Array.isArray(row["category_path"])
      ? (row["category_path"] as { name?: unknown }[])
          .map((c) => text(c?.name))
          .filter((v): v is string => Boolean(v))
      : [],
    collections: Array.isArray(row["collections"])
      ? (row["collections"] as { title?: unknown }[])
          .map((c) => text(c?.title))
          .filter((v): v is string => Boolean(v))
      : [],
    images: mediaRows
      .map((m) => ({ url: text(m["url"]), alt: text(m["alt"]) }))
      .filter((m): m is { url: string; alt: string | null } => Boolean(m["url"])),
    options: optionRows.flatMap((o) =>
      typeof o["name"] === "string" ? [{ name: o["name"], values: strings(o["values"]) }] : [],
    ),
    variants,
    last_updated_at: text(row["updated_at"]) ?? text(row["last_updated_at"]),
  };
}
