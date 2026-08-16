import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CLASSIFIER_VERSION,
  FALLBACK_SLUG,
  buildCategoryTree,
  checkGuardrails,
  detectGuardrails,
  nearestSafeParent,
  scoreCategories,
  tierFor,
  type CategoryNode,
  type ClassificationSubject,
} from "./taxonomy";
import { assessQuality, contentFingerprint, type ProductBundle } from "./core.server";

/**
 * Catalogue Intelligence.
 *
 * Supplier feeds are treated as evidence, never as truth. A category is only
 * accepted when keyword evidence, family guardrails and the semantic pass all
 * agree. When they do not, the product falls back to the nearest safe branch
 * and is flagged for attention rather than guessed into the wrong aisle.
 */

type Db = SupabaseClient<any, "public", any>;

export interface ClassificationOutcome {
  productId: string;
  categorySlug: string;
  categoryName: string;
  confidence: number;
  tier: "high" | "medium" | "low";
  reasoning: string;
  corrected: boolean;
  needsAttention: boolean;
  anomalies: Array<{ code: string; label: string }>;
}

export async function loadCategories(db: Db): Promise<CategoryNode[]> {
  const { data, error } = await db
    .from("catalogue_categories")
    .select("id, slug, name, parent_id, enabled, is_fallback, sort_order, keywords, synonyms, description")
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return buildCategoryTree((data ?? []) as never);
}

export function subjectFor(bundle: ProductBundle): ClassificationSubject {
  const optionValues: string[] = [];
  if (Array.isArray(bundle.product.options)) {
    for (const option of bundle.product.options as any[]) {
      if (option && Array.isArray(option.values)) {
        for (const value of option.values) if (typeof value === "string") optionValues.push(value);
      }
    }
  }
  return {
    title: bundle.product.title ?? "",
    description: (bundle.product.description ?? "").slice(0, 6000),
    productType: bundle.product.product_type ?? null,
    vendor: bundle.product.vendor ?? null,
    tags: bundle.product.tags ?? [],
    variantTitles: bundle.variants.map((variant) => variant.title).filter(Boolean),
    optionValues,
  };
}

const CLASSIFIER_RULES = [
  "You classify retail products into a fixed NUR GOODS category list.",
  "Supplier categories are frequently wrong, so judge from the product itself: title, description, variants and options.",
  "Choose the most specific category that is genuinely correct. Never invent a category outside the supplied list.",
  "Never invent specifications, materials, dimensions, compatibility, certifications or safety claims.",
  "Confidence must be honest. Use a low value when the product content is too vague to place precisely.",
  "Never use em dashes.",
  "Return strict JSON only, with no commentary and no code fences.",
].join(" ");

interface ModelVerdict {
  slug: string | null;
  confidence: number;
  reasoning: string;
  model: string | null;
}

async function askModel(
  subject: ClassificationSubject,
  categories: CategoryNode[],
): Promise<ModelVerdict> {
  const { resolveAdapter } = await import("@/lib/ai/runtime.server");
  const options = categories
    .filter((category) => category.enabled && !category.is_fallback)
    .map((category) => ({ slug: category.slug, path: category.path.join(" > ") }));

  const adapter = resolveAdapter();
  const result = await adapter.complete({
    stage: "topic_discovery",
    promptVersionKey: "catalogue.classify",
    responseSchema: {},
    temperature: 0.1,
    maxOutputTokens: 700,
    messages: [
      { role: "system", content: CLASSIFIER_RULES },
      {
        role: "user",
        content: `Pick one category slug for this product. Return JSON {"category_slug": string, "confidence": number between 0 and 1, "reasoning": string under 300 characters, "supplier_category_looks_wrong": boolean}.\n\nCategories:\n${JSON.stringify(
          options,
        )}\n\nProduct:\n${JSON.stringify({
          title: subject.title,
          supplier_product_type: subject.productType,
          vendor: subject.vendor,
          tags: subject.tags.slice(0, 30),
          variants: subject.variantTitles.slice(0, 12),
          options: subject.optionValues.slice(0, 20),
          description: subject.description.slice(0, 2500),
        })}`,
      },
    ],
  });

  const parsed = (result.parsed ?? {}) as Record<string, unknown>;
  const confidence = Number(parsed["confidence"]);
  return {
    slug: typeof parsed["category_slug"] === "string" ? parsed["category_slug"].trim() : null,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    reasoning: typeof parsed["reasoning"] === "string" ? parsed["reasoning"].slice(0, 400) : "",
    model: result.model ?? null,
  };
}

/** Runs the full classification pipeline for one product and stores the result. */
export async function classifyProduct(
  db: Db,
  bundle: ProductBundle,
  categories: CategoryNode[],
): Promise<ClassificationOutcome> {
  const bySlug = new Map(categories.map((category) => [category.slug, category]));
  const fallback = bySlug.get(FALLBACK_SLUG) ?? null;

  const subject = subjectFor(bundle);
  const guardrails = detectGuardrails(subject);
  const keywordScores = scoreCategories(subject, categories);
  const anomalies: Array<{ code: string; label: string }> = [];

  let verdict: ModelVerdict = { slug: null, confidence: 0, reasoning: "", model: null };
  let modelFailure: string | null = null;
  try {
    verdict = await askModel(subject, categories);
  } catch (cause) {
    modelFailure = cause instanceof Error ? cause.message : "The semantic pass was unavailable";
  }

  let chosen = verdict.slug ? (bySlug.get(verdict.slug) ?? null) : null;
  let confidence = chosen ? verdict.confidence : 0;
  let reasoning = verdict.reasoning;
  let corrected = false;

  // Deterministic evidence stands in when the semantic pass is unavailable or
  // returned a slug that is not part of the taxonomy.
  if (!chosen && keywordScores.length > 0) {
    chosen = bySlug.get(keywordScores[0]!.slug) ?? null;
    confidence = Math.min(0.7, 0.35 + keywordScores[0]!.score / 60);
    reasoning = modelFailure
      ? `Placed from catalogue keyword evidence because the semantic pass was unavailable. Matched: ${keywordScores[0]!.matched.slice(0, 5).join(", ")}.`
      : `Placed from catalogue keyword evidence. Matched: ${keywordScores[0]!.matched.slice(0, 5).join(", ")}.`;
    if (modelFailure) {
      anomalies.push({ code: "semantic_pass_unavailable", label: modelFailure });
    }
  }

  // Family guardrails. A grooming appliance cannot land in Toys, a kitchen
  // appliance cannot land in Personal Care, and so on.
  const verdictCheck = checkGuardrails(chosen, guardrails);
  if (!verdictCheck.ok && verdictCheck.correctedSlug) {
    const safe = bySlug.get(verdictCheck.correctedSlug) ?? null;
    if (safe) {
      anomalies.push({
        code: "guardrail_correction",
        label: `Rejected ${chosen?.slug ?? "an unusable category"} because the product reads as ${verdictCheck.violated[0]!.label.toLowerCase()}.`,
      });
      chosen = safe;
      corrected = true;
      confidence = Math.max(confidence, 0.85);
      reasoning =
        `${reasoning} Corrected to ${safe.name} by the ${verdictCheck.violated[0]!.ruleId} rule.`.trim();
    }
  } else if (guardrails.length > 0 && chosen) {
    // Guardrail agreement is strong supporting evidence.
    confidence = Math.max(confidence, 0.82);
  }

  // Disagreement between keyword evidence and the semantic pass lowers trust.
  const keywordTop = keywordScores[0] ? bySlug.get(keywordScores[0].slug) : null;
  if (
    chosen &&
    keywordTop &&
    keywordTop.root_slug !== chosen.root_slug &&
    keywordScores[0]!.score >= 12 &&
    guardrails.length === 0
  ) {
    confidence = Math.min(confidence, 0.6);
    anomalies.push({
      code: "evidence_disagreement",
      label: `Keyword evidence pointed at ${keywordTop.name} while the semantic pass chose ${chosen.name}.`,
    });
  }

  let tier = tierFor(confidence);
  let needsAttention = false;

  if (tier === "medium" && chosen) {
    // Medium confidence keeps the branch but steps back to the safe parent
    // unless deterministic evidence backs the exact leaf.
    const leafBackedByKeywords = keywordScores.some(
      (score) => score.slug === chosen!.slug && score.score >= 8,
    );
    if (!leafBackedByKeywords && !corrected) {
      const parent = nearestSafeParent(chosen, categories);
      if (parent && !parent.is_fallback) {
        reasoning = `${reasoning} Held at ${parent.name} because the exact subcategory is not clearly supported.`.trim();
        chosen = parent;
      }
    }
  }

  if (!chosen || tier === "low") {
    const parent = chosen ? nearestSafeParent(chosen, categories) : null;
    chosen = parent && !parent.is_fallback ? parent : (fallback ?? chosen);
    needsAttention = true;
    tier = "low";
    if (!reasoning) {
      reasoning =
        "The supplied product content is not specific enough to place this item confidently, so it sits in a broader category until better content is available.";
    }
    anomalies.push({
      code: "low_confidence",
      label: "Placed in a broader category because the product content is not specific enough.",
    });
  }

  if (!chosen) throw new Error("The category taxonomy is empty");

  const supplierType = bundle.product.product_type?.trim() || null;
  if (corrected && supplierType) {
    anomalies.push({
      code: "supplier_category_anomaly",
      label: `The supplier classified this as "${supplierType}".`,
    });
  }


  const quality = assessQuality(bundle);
  if (quality.issues.some((issue) => issue.code === "no_imagery")) {
    anomalies.push({ code: "missing_imagery", label: "No usable product imagery is mirrored." });
  }

  // Existing record, so a genuine change can be logged.
  const { data: existing } = await db
    .from("product_classifications")
    .select("id, category_slug")
    .eq("product_id", bundle.product.id)
    .maybeSingle();
  const previousSlug = (existing as any)?.category_slug ?? null;

  const row = {
    product_id: bundle.product.id,
    category_id: chosen.id,
    category_slug: chosen.slug,
    confidence,
    confidence_tier: tier,
    reasoning: reasoning.slice(0, 1000) || null,
    supplier_product_type: supplierType,
    supplier_tags: bundle.product.tags ?? [],
    supplier_vendor: bundle.product.vendor ?? null,
    anomaly_flags: anomalies,
    quality_score: quality.score,
    quality_issues: quality.issues,
    needs_attention: needsAttention || anomalies.some((item) => item.code === "evidence_disagreement"),
    auto_published: true,
    classifier_model: verdict.model,
    classifier_version: CLASSIFIER_VERSION,
    input_fingerprint: contentFingerprint(bundle),
    last_classified_at: new Date().toISOString(),
  };

  const { error } = await db
    .from("product_classifications")
    .upsert(row as never, { onConflict: "product_id" });
  if (error) throw new Error(error.message);

  if (previousSlug !== chosen.slug) {
    await db.from("product_classification_history").insert({
      product_id: bundle.product.id,
      supplier_category: supplierType,
      previous_category_slug: previousSlug,
      new_category_slug: chosen.slug,
      confidence,
      confidence_tier: tier,
      reason: reasoning.slice(0, 1000) || "Automatic classification.",
      source: "automatic",
    } as never);
  }

  return {
    productId: bundle.product.id,
    categorySlug: chosen.slug,
    categoryName: chosen.name,
    confidence,
    tier,
    reasoning,
    corrected,
    needsAttention: row.needs_attention,
    anomalies,
  };
}
