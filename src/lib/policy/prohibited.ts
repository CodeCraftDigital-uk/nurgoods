/**
 * Prohibited category control for NUR GOODS.
 *
 * NUR GOODS is a general UK lifestyle marketplace. Adult and sexual products
 * are not part of the range and must never be sourced, imported, published or
 * reactivated. The check is deterministic, reads every field the supplier or
 * the store already provides, and carries a plain reason so an administrator
 * can always see why a product was refused.
 *
 * The matcher deliberately combines strong single terms with paired context
 * terms. A word such as "massager" or "lubricant" is ordinary on its own, so
 * it only counts when it appears alongside an unmistakably sexual qualifier.
 * That keeps genuine health, maternity, massage, beauty and wellness products
 * eligible.
 */

export type ProhibitedCategory = "adult_sexual";

export interface ProhibitedMatch {
  prohibited: boolean;
  category: ProhibitedCategory | null;
  /** The terms that produced the decision, for audit and admin reporting. */
  terms: string[];
  reason: string | null;
}

export interface ProhibitedFields {
  title?: string | null;
  description?: string | null;
  descriptionHtml?: string | null;
  productType?: string | null;
  category?: string | null;
  vendor?: string | null;
  tags?: string[] | string | null;
  handle?: string | null;
  /** Any additional supplier metadata such as collections or option names. */
  extra?: Array<string | null | undefined> | null;
}

/** Terms that are prohibited on their own, in any field. */
const STRONG_TERMS: RegExp[] = [
  /\banal\b/,
  /\bbutt ?plugs?\b/,
  /\banal beads?\b/,
  /\bsex toys?\b/,
  /\bsex ?machine\b/,
  /\bsexual (?:stimulation|pleasure|wellness device)\b/,
  /\bvibrators?\b/,
  /\bdildos?\b/,
  /\bmasturbat(?:or|ors|ion|ing|e)\b/,
  /\bfleshlight\b/,
  /\bonahole\b/,
  /\bpocket pussy\b/,
  /\bvagina[l]? (?:tightening|pump|balls?|beads?)\b/,
  /\bkegel balls?\b/,
  /\bben wa balls?\b/,
  /\bpenis (?:ring|rings|pump|sleeve|extender|enlarg\w*)\b/,
  /\bcock ?rings?\b/,
  /\bprostate (?:massager|stimulator)\b/,
  /\bg[- ]?spot\b/,
  /\bclitoral\b/,
  /\bclit\b/,
  /\bnipple clamps?\b/,
  /\bbdsm\b/,
  /\bbondage\b/,
  /\bhandcuffs? (?:sex|fetish|bondage)\b/,
  /\bfetish\b/,
  /\bsex(?:ual)? lubricant\b/,
  /\bpersonal lubricant\b/,
  /\bcondoms?\b/,
  /\bstrap[- ]?on\b/,
  /\bsex doll\b/,
  /\bblow ?job\b/,
  /\berotic\b/,
  /\baphrodisiac\b/,
  /\borgasm\b/,
  /\bhentai\b/,
  /\bporn\w*\b/,
  /\bnsfw\b/,
  /\bxxx\b/,
  /\b18\+\b/,
  /\badult (?:toys?|products?|store|only|shop|novelt\w+)\b/,
];

/**
 * Terms that only become prohibited when a sexual qualifier is also present.
 * This is what keeps a maternity massager, a facial device or a muscle gun in
 * the catalogue while still catching supplier wording such as
 * "adult massager for couples pleasure".
 */
const WEAK_TERMS: RegExp[] = [
  /\bmassagers?\b/,
  /\bstimulators?\b/,
  /\bplugs?\b/,
  /\bbeads?\b/,
  /\bsleeves?\b/,
  /\bwands?\b/,
  /\bteaser\b/,
  /\bharness\b/,
  /\blubricants?\b/,
];

const SEXUAL_QUALIFIERS: RegExp[] = [
  /\bsex\b/,
  /\bsexual(?:ly)?\b/,
  /\bsexy\b/,
  /\bintimate\b/,
  /\bintimacy\b/,
  /\bpleasure\b/,
  /\bfore ?play\b/,
  /\bcouples? (?:play|toy|fun|pleasure)\b/,
  /\bgenital\w*\b/,
  /\bvagina\w*\b/,
  /\bpenis\b/,
  /\bpenile\b/,
  /\bvulva\b/,
  /\banus\b/,
  /\brectal\b/,
  /\bnipples?\b/,
  /\baroused?\b/,
  /\barousal\b/,
];

function tagList(tags: ProhibitedFields["tags"]): string[] {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.filter((tag): tag is string => typeof tag === "string");
  return String(tags).split(",");
}

/** Flattens every provided field into one lowercase haystack. */
export function prohibitedHaystack(fields: ProhibitedFields): string {
  const parts = [
    fields.title,
    fields.description,
    (fields.descriptionHtml ?? "").replace(/<[^>]*>/g, " "),
    fields.productType,
    fields.category,
    fields.vendor,
    (fields.handle ?? "").replace(/[-_]+/g, " "),
    ...tagList(fields.tags),
    ...((fields.extra ?? []).filter(Boolean) as string[]),
  ];
  return parts
    .filter(Boolean)
    .join(" \n ")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ");
}

function label(pattern: RegExp): string {
  return pattern.source.replace(/\\b|\(\?:|[()?:\\]|\[[^\]]*\]|\+|\*/g, "").trim();
}

/**
 * Decides whether a product falls into a prohibited category. Only the
 * adult/sexual category exists today, and it is applied everywhere a product
 * can enter or re-enter the customer facing catalogue.
 */
export function screenProhibited(fields: ProhibitedFields): ProhibitedMatch {
  const haystack = prohibitedHaystack(fields);
  if (!haystack) return { prohibited: false, category: null, terms: [], reason: null };

  const strongHits = STRONG_TERMS.filter((pattern) => pattern.test(haystack));
  if (strongHits.length > 0) {
    const terms = strongHits.map(label);
    return {
      prohibited: true,
      category: "adult_sexual",
      terms,
      reason: `Adult or sexual product signal detected (${terms.slice(0, 3).join(", ")})`,
    };
  }

  const qualifier = SEXUAL_QUALIFIERS.find((pattern) => pattern.test(haystack));
  if (qualifier) {
    const weak = WEAK_TERMS.filter((pattern) => pattern.test(haystack));
    if (weak.length > 0) {
      const terms = [label(qualifier), ...weak.map(label)];
      return {
        prohibited: true,
        category: "adult_sexual",
        terms,
        reason: `Adult or sexual product signal detected (${terms.slice(0, 3).join(" + ")})`,
      };
    }
  }

  return { prohibited: false, category: null, terms: [], reason: null };
}

export function isProhibitedProduct(fields: ProhibitedFields): boolean {
  return screenProhibited(fields).prohibited;
}

/**
 * Convenience wrapper for a mirrored store product row, which uses the
 * snake_case field names of the catalogue mirror.
 */
export function screenProhibitedRow(row: {
  title?: string | null;
  handle?: string | null;
  description?: string | null;
  description_html?: string | null;
  product_type?: string | null;
  vendor?: string | null;
  tags?: string[] | string | null;
}): ProhibitedMatch {
  return screenProhibited({
    title: row.title ?? null,
    handle: row.handle ?? null,
    description: row.description ?? null,
    descriptionHtml: row.description_html ?? null,
    productType: row.product_type ?? null,
    vendor: row.vendor ?? null,
    tags: row.tags ?? null,
  });
}

export function isProhibitedRow(row: Parameters<typeof screenProhibitedRow>[0]): boolean {
  return screenProhibitedRow(row).prohibited;
}
