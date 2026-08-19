import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildBreadcrumbInputs,
  buildProductSchemaInputs,
  contentFingerprint,
  factsFingerprint,
  sha,
  slugify,
  validateSeoDraft,
  type ProductBundle,
  type SeoValidationContext,
} from "./core.server";
import { MARKETPLACE_IDENTITY_RULES, resolveProductBrand } from "./marketplace-identity";
import { SEO_VERSION, type CategoryNode } from "./taxonomy";


/**
 * SEO Intelligence.
 *
 * Produces search, answer engine, generative engine and assistant readiness
 * data per product. The semantic pass only ever writes wording. Every factual
 * element in the schema is assembled from mirrored catalogue values, so no
 * rating, certification, delivery promise or availability claim can be
 * invented.
 */

type Db = SupabaseClient<any, "public", any>;

export interface SeoBatchContext {
  usedTitles: Map<string, string>;
  usedDescriptions: Map<string, string>;
  validProductHandles: Set<string>;
  validCollectionHandles: Set<string>;
  validArticleSlugs: Set<string>;
}

/** Builds the catalogue wide context used by the deterministic validator. */
export async function loadSeoContext(db: Db): Promise<SeoBatchContext> {
  const [products, collections, articles, intelligence] = await Promise.all([
    db.from("shopify_products").select("id, handle").limit(5000),
    db.from("shopify_collections").select("handle").limit(1000),
    db.from("articles").select("slug").eq("status", "published").limit(1000),
    db.from("product_seo_intelligence").select("product_id, seo_title, meta_description").limit(5000),
  ]);

  const usedTitles = new Map<string, string>();
  const usedDescriptions = new Map<string, string>();
  for (const row of ((intelligence.data ?? []) as any[])) {
    if (row.seo_title) usedTitles.set(String(row.seo_title).toLowerCase(), row.product_id);
    if (row.meta_description) usedDescriptions.set(String(row.meta_description).toLowerCase(), row.product_id);
  }

  return {
    usedTitles,
    usedDescriptions,
    validProductHandles: new Set(((products.data ?? []) as any[]).map((row) => row.handle as string)),
    validCollectionHandles: new Set(((collections.data ?? []) as any[]).map((row) => row.handle as string)),
    validArticleSlugs: new Set(((articles.data ?? []) as any[]).map((row) => row.slug as string)),
  };
}

const SEO_RULES = [
  ...MARKETPLACE_IDENTITY_RULES,
  "Write naturally for people first, then for search engines, answer engines and assistants.",
  "Use British English. The tagline is: Good things, brought to light.",
  "Only state facts that appear in the supplied product data. If a detail is absent, leave it out.",
  "Never mention price, stock levels, delivery times, warranties, ratings, reviews or certifications.",
  "Never invent materials, dimensions, compatibility, country of origin, performance figures or health claims.",
  "Never use superlatives such as best, number one or world leading.",
  "Never repeat a keyword unnaturally. Never use em dashes.",
  "Answer questions only when the supplied product data genuinely answers them. Return an empty list otherwise.",
  "Answer first: the opening sentence of every FAQ answer must answer the question directly.",
  "Return strict JSON only, with no commentary and no code fences.",
].join(" ");


/** Deterministic input hash. Price and stock changes never invalidate wording. */
export function seoInputHash(bundle: ProductBundle, categorySlug: string | null): string {
  return sha(`${contentFingerprint(bundle)}|${categorySlug ?? ""}|${SEO_VERSION}`);
}
/** Failures on unchanged source data park the record after this many tries. */
export const MAX_REGENERATION_ATTEMPTS = 3;


export interface SeoOutcome {
  productId: string;
  state: "valid" | "needs_attention" | "rejected" | "manual_review";
  score: number;
  issues: Array<{ code: string; label: string; severity: string }>;
  published: boolean;
}

export async function optimiseProduct(
  db: Db,
  bundle: ProductBundle,
  category: CategoryNode | null,
  categories: CategoryNode[],
  context: SeoBatchContext,
): Promise<SeoOutcome> {
  const product = bundle.product;
  const byId = new Map(categories.map((node) => [node.id, node]));
  const trail: Array<{ name: string; path: string }> = [{ name: "Store", path: "/store" }];
  if (category) {
    for (const slug of category.path) {
      const node = categories.find((item) => item.slug === slug);
      if (node) trail.push({ name: node.name, path: `/store?category=${node.slug}` });
    }
  }
  trail.push({ name: product.title, path: `/shop/${product.handle}` });
  void byId;

  // Separate brand, manufacturer, supplier and marketplace before the model
  // ever sees the record, so a marketplace vendor value cannot become a maker.
  const identity = resolveProductBrand({
    vendor: product.vendor,
    tags: product.tags ?? [],
    metafields: (product as any).metafields ?? null,
  });

  const { resolveAdapter } = await import("@/lib/ai/runtime.server");
  const adapter = resolveAdapter();


  const result = await adapter.complete({
    stage: "metadata_schema",
    promptVersionKey: "catalogue.seo",
    responseSchema: {},
    temperature: 0.3,
    maxOutputTokens: 3200,
    messages: [
      { role: "system", content: SEO_RULES },
      {
        role: "user",
        content: `Produce search intelligence for this product. Return JSON {"seo_title": string under 60 characters, "meta_description": string between 90 and 155 characters, "slug_recommendation": string, "primary_topic": string, "entities": string[], "keywords": string[], "image_alt": string under 125 characters, "og_title": string, "og_description": string, "entity_summary": factual paragraph under 800 characters describing what the product is, what it is for and who it suits, "description_sections": [{"heading": string, "body": string}] covering overview, benefits, use cases and specifications only where the data supports them, "faqs": [{"question": string, "answer": string}], "internal_links": [{"anchor_text": string, "target_type": "product"|"collection", "target_reference": string}], "collection_relevance": [{"handle": string, "relevance": string}]}.\n\nProduct:\n${JSON.stringify(
          {
            title: product.title,
            handle: product.handle,
            canonical_category: category ? category.path.join(" > ") : null,
            supplier_product_type: product.product_type,
            // Brand and manufacturer are only ever populated from evidenced
            // source data. The store vendor value is the marketplace itself.
            brand: identity.brand ?? "not specified",
            manufacturer: identity.manufacturer ?? "not specified",
            sold_through_marketplace: "NUR GOODS",
            tags: (product.tags ?? []).slice(0, 30),
            description: (product.description ?? "").slice(0, 3500),
            options: product.options,
            variants: bundle.variants.slice(0, 12).map((variant) => variant.title),
            collections: bundle.collections.map((item) => item.handle),
          },

        )}\n\nAvailable link targets:\n${JSON.stringify({
          collections: [...context.validCollectionHandles].slice(0, 60),
          products: [...context.validProductHandles].slice(0, 80),
        })}`,
      },
    ],
  });

  const validationContext: SeoValidationContext = {
    bundle,
    usedTitles: context.usedTitles,
    usedDescriptions: context.usedDescriptions,
    validProductHandles: context.validProductHandles,
    validCollectionHandles: context.validCollectionHandles,
    validArticleSlugs: context.validArticleSlugs,
  };

  const validation = validateSeoDraft((result.parsed ?? {}) as never, validationContext);
  const draft = validation.draft;

  // Safe deterministic fill so a rejected or thin draft still leaves the
  // product with usable, factual metadata.
  if (!draft.seo_title) draft.seo_title = product.title.slice(0, 60);
  if (!draft.image_alt) draft.image_alt = product.title.slice(0, 125);
  if (!draft.slug_recommendation) draft.slug_recommendation = slugify(product.handle);
  if (!draft.primary_topic && category) draft.primary_topic = category.name;

  const schemaInputs = buildProductSchemaInputs(bundle, {
    description: draft.meta_description || product.description,
    categoryPath: category ? category.path : [],
    canonicalPath: `/shop/${product.handle}`,
  });

  const inputHash = seoInputHash(bundle, category?.slug ?? null);

  // Loop guard. A record that keeps failing on unchanged source data is parked
  // for a person instead of being regenerated forever by the worker.
  const { data: previous } = await db
    .from("product_seo_intelligence")
    .select("input_hash, regeneration_attempts")
    .eq("product_id", product.id)
    .maybeSingle();
  const sameInput = previous ? (previous as any).input_hash === inputHash : false;
  const attempts = sameInput ? Number((previous as any).regeneration_attempts ?? 0) + 1 : 1;

  const identityIssues = validation.issues.filter((issue) => issue.code.startsWith("identity_"));
  const manualReview = validation.state === "rejected" && attempts >= MAX_REGENERATION_ATTEMPTS;
  const state = manualReview ? "manual_review" : validation.state;
  const published = validation.state !== "rejected";

  const row = {
    product_id: product.id,
    seo_title: draft.seo_title,
    meta_description: draft.meta_description || null,
    slug_recommendation: draft.slug_recommendation,
    primary_topic: draft.primary_topic || null,
    entities: draft.entities,
    keywords: draft.keywords,
    image_alt: draft.image_alt,
    og_title: draft.og_title || draft.seo_title,
    og_description: draft.og_description || draft.meta_description,
    faqs: draft.faqs,
    description_sections: draft.description_sections,
    entity_summary: draft.entity_summary || null,
    internal_links: draft.internal_links,
    collection_relevance: draft.collection_relevance,
    schema_inputs: {
      product: schemaInputs,
      breadcrumb: buildBreadcrumbInputs(trail),
      facts_fingerprint: factsFingerprint(bundle),
    },
    optimisation_score: validation.score,
    validation_state: state,
    issues: validation.issues,
    identity_findings: identityIssues,
    identity_checked_at: new Date().toISOString(),
    regeneration_attempts: manualReview ? attempts : sameInput ? attempts : 0,
    manual_review_reason: manualReview
      ? validation.issues.find((issue) => issue.severity === "error")?.label ?? "Repeated validation failure."
      : null,
    input_hash: inputHash,
    model: result.model ?? null,
    intelligence_version: SEO_VERSION,
    auto_published: published,
    last_analysed_at: new Date().toISOString(),
  };

  const { error } = await db
    .from("product_seo_intelligence")
    .upsert(row as never, { onConflict: "product_id" });
  if (error) throw new Error(error.message);


  // Keep the in-memory duplicate guard current inside a batch.
  if (row.seo_title) context.usedTitles.set(row.seo_title.toLowerCase(), product.id);
  if (row.meta_description) context.usedDescriptions.set(row.meta_description.toLowerCase(), product.id);

  return {
    productId: product.id,
    state: validation.state,
    score: validation.score,
    issues: validation.issues,
    published,
  };
}

/**
 * Refreshes only the commercial facts in stored schema. Used when a sync
 * carried a price or stock change, so no model run is needed.
 */
export async function refreshProductFacts(
  db: Db,
  bundle: ProductBundle,
  category: CategoryNode | null,
): Promise<boolean> {
  const { data } = await db
    .from("product_seo_intelligence")
    .select("id, schema_inputs, meta_description")
    .eq("product_id", bundle.product.id)
    .maybeSingle();
  if (!data) return false;

  const existing = (data as any).schema_inputs ?? {};
  const schemaInputs = buildProductSchemaInputs(bundle, {
    description: (data as any).meta_description ?? bundle.product.description,
    categoryPath: category ? category.path : [],
    canonicalPath: `/shop/${bundle.product.handle}`,
  });

  await db
    .from("product_seo_intelligence")
    .update({
      schema_inputs: {
        ...existing,
        product: schemaInputs,
        facts_fingerprint: factsFingerprint(bundle),
      },
    } as never)
    .eq("id", (data as any).id);
  return true;
}
