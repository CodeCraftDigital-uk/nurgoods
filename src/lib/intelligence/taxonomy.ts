/**
 * Canonical NUR GOODS taxonomy helpers.
 *
 * Everything in this module is deterministic. Supplier feeds routinely carry
 * wrong categories, so the platform never trusts product_type or supplier tags
 * on their own. Keyword evidence and hard incompatibility rules run before and
 * after the semantic pass, and the semantic pass can only ever choose from the
 * stored taxonomy.
 */

export interface CategoryNode {
  id: string;
  slug: string;
  name: string;
  parent_id: string | null;
  parent_slug: string | null;
  root_slug: string;
  path: string[];
  enabled: boolean;
  is_fallback: boolean;
  sort_order: number;
  keywords: string[];
  synonyms: string[];
  description: string | null;
}

export interface ClassificationSubject {
  title: string;
  description: string;
  productType: string | null;
  vendor: string | null;
  tags: string[];
  variantTitles: string[];
  optionValues: string[];
}

/** Slug of the branch used when nothing can be established safely. */
export const FALLBACK_SLUG = "general";

/** Bumped whenever classification behaviour changes materially. */
export const CLASSIFIER_VERSION = "catalogue-intelligence-1";

/** Bumped whenever the search intelligence contract changes materially. */
export const SEO_VERSION = "seo-intelligence-1";

export function buildCategoryTree(
  rows: Array<{
    id: string;
    slug: string;
    name: string;
    parent_id: string | null;
    enabled: boolean;
    is_fallback: boolean;
    sort_order: number;
    keywords: string[] | null;
    synonyms: string[] | null;
    description: string | null;
  }>,
): CategoryNode[] {
  const byId = new Map(rows.map((row) => [row.id, row]));

  return rows.map((row) => {
    const path: string[] = [];
    let cursor: typeof row | undefined = row;
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor.id)) {
      guard.add(cursor.id);
      path.unshift(cursor.slug);
      cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined;
    }
    const parent = row.parent_id ? byId.get(row.parent_id) : undefined;
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      parent_id: row.parent_id,
      parent_slug: parent?.slug ?? null,
      root_slug: path[0] ?? row.slug,
      path,
      enabled: row.enabled,
      is_fallback: row.is_fallback,
      sort_order: row.sort_order,
      keywords: row.keywords ?? [],
      synonyms: row.synonyms ?? [],
      description: row.description,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Guardrails                                                          */
/* ------------------------------------------------------------------ */

export interface GuardrailRule {
  id: string;
  label: string;
  /** Strong evidence that the product belongs to this family. */
  patterns: RegExp[];
  /** Terms that cancel the rule because they indicate a different item. */
  negations?: RegExp[];
  /** Top level branches the product is allowed to sit in. */
  allowedRoots: string[];
  /** Safe leaf used when the chosen category breaks the rule. */
  preferredSlug: string;
}

/**
 * Reusable incompatibility rules. These are family level, not one product at a
 * time, so a mis-supplied grooming appliance, kitchen appliance, baby item or
 * car accessory is corrected by the same mechanism.
 */
export const GUARDRAIL_RULES: GuardrailRule[] = [
  {
    id: "grooming-appliance",
    label: "Grooming and shaving appliance",
    patterns: [
      /\b(hair|beard|body|nose|ear|facial)?\s*(trimmer|clipper|shaver)\b/i,
      /\brazor\b/i,
      /\bepilator\b/i,
      /\bgrooming (kit|set|tool)\b/i,
      /\bstubble\b/i,
      /\bhair removal\b/i,
    ],
    allowedRoots: ["personal-care"],
    preferredSlug: "grooming-and-shaving",
  },
  {
    id: "hair-styling",
    label: "Hair styling appliance",
    patterns: [/\bhair (dryer|straightener|curler|iron)\b/i, /\bblow dry(er)?\b/i, /\bcurling wand\b/i],
    allowedRoots: ["personal-care"],
    preferredSlug: "hair-care",
  },
  {
    id: "oral-care",
    label: "Oral care",
    patterns: [/\btoothbrush\b/i, /\bwater flosser\b/i, /\bdental (kit|scaler|floss)\b/i, /\btongue scraper\b/i],
    allowedRoots: ["personal-care"],
    preferredSlug: "oral-care",
  },
  {
    id: "kitchen-appliance",
    label: "Kitchen appliance or cookware",
    patterns: [
      /\b(blender|kettle|toaster|air fryer|coffee (maker|machine)|food processor|milk frother)\b/i,
      /\b(frying pan|saucepan|wok|chopping board|peeler|garlic press|can opener)\b/i,
    ],
    negations: [/\bpet\b/i, /\bdog\b/i, /\bcat\b/i],
    allowedRoots: ["home-and-living"],
    preferredSlug: "kitchen-and-dining",
  },
  {
    id: "baby-item",
    label: "Baby or infant item",
    patterns: [
      /\b(baby|infant|newborn|toddler)\b/i,
      /\b(pram|pushchair|stroller|nappy|nappies|pacifier|dummy|teether|bib|baby bottle)\b/i,
    ],
    allowedRoots: ["baby-and-kids", "toys-and-games"],
    preferredSlug: "baby-essentials",
  },
  {
    id: "pet-item",
    label: "Pet item",
    patterns: [/\b(pet|dog|cat|puppy|kitten|hamster|aquarium)\b/i, /\bcat litter\b/i],
    allowedRoots: ["pets"],
    preferredSlug: "pet-accessories",
  },
  {
    id: "automotive-item",
    label: "Vehicle accessory",
    patterns: [
      /\b(car|vehicle|automotive|motorbike|motorcycle)\b/i,
      /\b(windscreen|windshield|dash ?cam|number plate|tyre|steering wheel)\b/i,
    ],
    negations: [/\bcar(d|go|pet|toon|rry)/i, /\bracing car\b/i, /\brc car\b/i, /\btoy car\b/i],
    allowedRoots: ["automotive"],
    preferredSlug: "car-accessories",
  },
  {
    id: "audio-device",
    label: "Audio device",
    patterns: [/\b(headphones?|earbuds?|earphones?|soundbar|bluetooth speaker)\b/i],
    allowedRoots: ["electronics-and-tech"],
    preferredSlug: "audio",
  },
  {
    id: "power-accessory",
    label: "Charging or power accessory",
    patterns: [/\b(power bank|charger|charging (cable|dock|station)|usb-?c cable|wall adapter)\b/i],
    allowedRoots: ["electronics-and-tech"],
    preferredSlug: "charging-and-power",
  },
  {
    id: "jewellery",
    label: "Jewellery",
    patterns: [/\b(necklace|bracelet|earrings?|pendant|anklet|brooch)\b/i],
    allowedRoots: ["fashion-and-accessories"],
    preferredSlug: "jewellery-and-watches",
  },
  {
    id: "play-item",
    label: "Toy or game",
    patterns: [
      /\b(jigsaw|board game|card game|action figure|plush toy|soft toy|building blocks?|lego|doll|rc car|toy car)\b/i,
    ],
    negations: [/\btrimmer\b/i, /\bshaver\b/i, /\brazor\b/i],
    allowedRoots: ["toys-and-games", "baby-and-kids"],
    preferredSlug: "toys",
  },
];

export interface GuardrailHit {
  ruleId: string;
  label: string;
  allowedRoots: string[];
  preferredSlug: string;
}

export function subjectText(subject: ClassificationSubject): string {
  return [
    subject.title,
    subject.title,
    subject.title,
    subject.productType ?? "",
    subject.tags.join(" "),
    subject.variantTitles.join(" "),
    subject.optionValues.join(" "),
    subject.description.slice(0, 4000),
  ]
    .join(" \n ")
    .toLowerCase();
}

/** Strong-signal families detected in the product text. */
export function detectGuardrails(subject: ClassificationSubject): GuardrailHit[] {
  const haystack = subjectText(subject);
  const hits: GuardrailHit[] = [];
  for (const rule of GUARDRAIL_RULES) {
    if (rule.negations?.some((pattern) => pattern.test(haystack))) continue;
    if (!rule.patterns.some((pattern) => pattern.test(haystack))) continue;
    hits.push({
      ruleId: rule.id,
      label: rule.label,
      allowedRoots: rule.allowedRoots,
      preferredSlug: rule.preferredSlug,
    });
  }
  return hits;
}

export interface GuardrailVerdict {
  ok: boolean;
  correctedSlug: string | null;
  violated: GuardrailHit[];
}

/** Rejects a candidate category that contradicts a detected family. */
export function checkGuardrails(
  candidate: CategoryNode | null,
  hits: GuardrailHit[],
): GuardrailVerdict {
  if (!candidate || hits.length === 0) return { ok: true, correctedSlug: null, violated: [] };
  const violated = hits.filter((hit) => !hit.allowedRoots.includes(candidate.root_slug));
  if (violated.length === 0) return { ok: true, correctedSlug: null, violated: [] };
  return { ok: false, correctedSlug: violated[0]!.preferredSlug, violated };
}

/* ------------------------------------------------------------------ */
/* Deterministic keyword scoring                                       */
/* ------------------------------------------------------------------ */

export interface KeywordScore {
  slug: string;
  score: number;
  matched: string[];
}

function weightedFields(subject: ClassificationSubject): Array<{ text: string; weight: number }> {
  return [
    { text: subject.title.toLowerCase(), weight: 6 },
    { text: (subject.productType ?? "").toLowerCase(), weight: 2 },
    { text: subject.tags.join(" ").toLowerCase(), weight: 2 },
    { text: subject.variantTitles.join(" ").toLowerCase(), weight: 1 },
    { text: subject.optionValues.join(" ").toLowerCase(), weight: 1 },
    { text: subject.description.slice(0, 4000).toLowerCase(), weight: 1 },
  ];
}

/** Ranks taxonomy leaves by keyword evidence found in the product content. */
export function scoreCategories(
  subject: ClassificationSubject,
  categories: CategoryNode[],
): KeywordScore[] {
  const fields = weightedFields(subject);
  const scores: KeywordScore[] = [];

  for (const category of categories) {
    if (!category.enabled || category.is_fallback) continue;
    const terms = [...category.keywords, ...category.synonyms]
      .map((term) => term.trim().toLowerCase())
      .filter(Boolean);
    if (terms.length === 0) continue;

    let score = 0;
    const matched: string[] = [];
    for (const term of terms) {
      let hit = false;
      for (const field of fields) {
        if (!field.text.includes(term)) continue;
        // Longer phrases are stronger evidence than single generic words.
        score += field.weight * (term.includes(" ") ? 2 : 1);
        hit = true;
      }
      if (hit) matched.push(term);
    }
    // A leaf beats its own parent when both match, so specific wins.
    if (score > 0) {
      scores.push({ slug: category.slug, score: score + (category.parent_id ? 2 : 0), matched });
    }
  }

  return scores.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
}

/** Nearest enabled ancestor, used when a leaf cannot be established safely. */
export function nearestSafeParent(
  node: CategoryNode | null,
  categories: CategoryNode[],
): CategoryNode | null {
  if (!node) return null;
  const bySlug = new Map(categories.map((category) => [category.slug, category]));
  const byId = new Map(categories.map((category) => [category.id, category]));
  let cursor: CategoryNode | null = node.parent_id ? (byId.get(node.parent_id) ?? null) : null;
  while (cursor && !cursor.enabled) {
    cursor = cursor.parent_id ? (byId.get(cursor.parent_id) ?? null) : null;
  }
  return cursor ?? bySlug.get(FALLBACK_SLUG) ?? null;
}

export function tierFor(confidence: number): "high" | "medium" | "low" {
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.55) return "medium";
  return "low";
}
