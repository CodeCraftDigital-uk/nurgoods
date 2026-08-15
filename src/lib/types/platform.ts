/**
 * Shared domain types for the NUR GOODS intelligence platform.
 *
 * Shopify remains the commerce source of truth. Everything modelled here is
 * either a read-only mirror of Shopify data or platform owned intelligence,
 * content and configuration. Nothing here participates in checkout.
 */
import type { Tables, TablesInsert, TablesUpdate, Enums } from "@/integrations/supabase/types";

export type SyncStatus = Enums<"sync_status">;
export type WorkflowStatus = Enums<"workflow_status">;
export type WorkflowStage = Enums<"workflow_stage">;
export type RunStatus = Enums<"run_status">;
export type OptimisationStatus = Enums<"optimisation_status">;
export type SeoTargetType = Enums<"seo_target_type">;
export type PlacementSurface = Enums<"placement_surface">;
export type AppRole = Enums<"app_role">;

export type ShopifyProduct = Tables<"shopify_products">;
export type ShopifyCollection = Tables<"shopify_collections">;
export type ProductEnrichment = Tables<"product_enrichment">;

export type ArticleBrief = Tables<"article_briefs">;
export type Article = Tables<"articles">;
export type ArticleInsert = TablesInsert<"articles">;
export type ArticleUpdate = TablesUpdate<"articles">;
export type ArticleSource = Tables<"article_sources">;
export type ArticleInternalLink = Tables<"article_internal_links">;

export type PromptVersion = Tables<"prompt_versions">;
export type AiGenerationRun = Tables<"ai_generation_runs">;

export type ReviewPlacement = Tables<"review_placements">;
export type SeoRecord = Tables<"seo_records">;
export type SeoEntity = Tables<"seo_entities">;
export type SeoQuestion = Tables<"seo_questions">;
export type AutomationJob = Tables<"automation_jobs">;
export type Integration = Tables<"integrations">;
export type IntegrationSetting = Tables<"integration_settings">;
export type IntegrationEvent = Tables<"integration_events">;
export type LegalDocument = Tables<"legal_documents">;
export type McpResource = Tables<"mcp_resources">;

/** A frequently asked question stored inside a jsonb column. */
export interface FaqItem {
  question: string;
  answer: string;
}

/** An internal link suggestion stored inside a jsonb column. */
export interface InternalLinkTarget {
  anchorText: string;
  targetType: SeoTargetType;
  targetReference: string;
  rationale?: string;
}

export const WORKFLOW_STATUS_LABEL: Record<WorkflowStatus, string> = {
  draft: "Draft",
  in_review: "In review",
  scheduled: "Scheduled",
  published: "Published",
  archived: "Archived",
};

export const WORKFLOW_STAGE_LABEL: Record<WorkflowStage, string> = {
  topic_discovery: "Topic discovery",
  brief: "Brief",
  research: "Research",
  draft: "Draft",
  source_verification: "Source verification",
  optimisation: "SEO, AEO, GEO and LLMO optimisation",
  internal_links: "Internal links",
  metadata_schema: "Metadata and schema",
  approval: "Approval",
  scheduling: "Scheduling",
};

export const OPTIMISATION_STATUS_LABEL: Record<OptimisationStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  needs_review: "Needs review",
  optimised: "Optimised",
};

export const PLACEMENT_SURFACE_LABEL: Record<PlacementSurface, string> = {
  homepage: "Homepage",
  product_page: "Product page",
  collection_page: "Collection page",
  cart: "Cart",
  article_page: "Article page",
  reviews_page: "Reviews page",
  footer: "Footer",
  custom: "Custom placement",
};

export function parseFaqs(value: unknown): FaqItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is FaqItem =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as FaqItem).question === "string",
  );
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export type ShopifyLegalSource = Tables<"shopify_legal_sources">;
