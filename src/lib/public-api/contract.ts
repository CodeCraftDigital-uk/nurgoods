/**
 * Versioned public connector contract for NUR GOODS.
 *
 * Everything described here is read only and public by design. The contract is
 * shared by the HTTP endpoints under /api/public/v1 and by the connector tools,
 * so both surfaces describe the same data with the same identifiers.
 *
 * Nothing in this file may reference admin state, credentials, prompts,
 * customer data, operational logs or unpublished editorial content.
 */
import { BRAND } from "@/lib/brand";

export const PUBLIC_API_VERSION = "2026-08-01";
export const PUBLIC_API_BASE = "/api/public/v1";

export const PAGE_LIMITS = {
  default: 20,
  max: 50,
} as const;

export const SEARCH_LIMITS = {
  minQueryLength: 2,
  maxQueryLength: 120,
} as const;

/** Stable machine readable error codes returned by every public endpoint. */
export type PublicErrorCode =
  | "invalid_request"
  | "not_found"
  | "rate_limited"
  | "unavailable"
  | "internal_error";

export interface PublicErrorBody {
  error: {
    code: PublicErrorCode;
    message: string;
    details?: Record<string, string>;
  };
  meta: PublicMeta;
}

export interface PublicMeta {
  version: string;
  generated_at: string;
  source: "nurgoods-platform";
}

export interface PublicPage {
  limit: number;
  offset: number;
  count: number;
  has_more: boolean;
}

/** Canonical public URLs. The store stays authoritative for commerce URLs. */
export const canonical = {
  product: (handle: string) => `${BRAND.storeUrl}/products/${handle}`,
  collection: (handle: string) => `${BRAND.storeUrl}/collections/${handle}`,
  article: (slug: string) => `${BRAND.siteUrl}/journal/${slug}`,
  legal: (slug: string) => `${BRAND.siteUrl}/legal/${slug}`,
  journalIndex: () => `${BRAND.siteUrl}/journal`,
  reviews: () => `${BRAND.siteUrl}/reviews`,
};

export interface ConnectorResourceSpec {
  key: string;
  label: string;
  description: string;
  httpPath: string;
  backingTables: string[];
  requiresStoreSync: boolean;
}

/**
 * The single declaration of the connector surface. The admin readiness screen
 * and the connector tool definitions both read from this list, so the two can
 * never drift apart.
 */
export const CONNECTOR_RESOURCES: ConnectorResourceSpec[] = [
  {
    key: "search_products",
    label: "Search products",
    description:
      "Search active store products by title, type, vendor or tag. Returns canonical store links.",
    httpPath: `${PUBLIC_API_BASE}/products`,
    backingTables: ["shopify_products", "product_enrichment"],
    requiresStoreSync: true,
  },
  {
    key: "get_product",
    label: "Get product",
    description:
      "Retrieve one active product by handle, including published long form content, benefits, specifications and delivery notes.",
    httpPath: `${PUBLIC_API_BASE}/products/{handle}`,
    backingTables: ["shopify_products", "product_enrichment"],
    requiresStoreSync: true,
  },
  {
    key: "search_categories",
    label: "Search categories",
    description: "List or search synced store collections with canonical links.",
    httpPath: `${PUBLIC_API_BASE}/collections`,
    backingTables: ["shopify_collections"],
    requiresStoreSync: true,
  },
  {
    key: "search_articles",
    label: "Search Journal articles",
    description:
      "Search published Journal articles by title, excerpt or tag. Only human approved, published content is returned.",
    httpPath: `${PUBLIC_API_BASE}/articles`,
    backingTables: ["articles"],
    requiresStoreSync: false,
  },
  {
    key: "get_article",
    label: "Get Journal article",
    description:
      "Retrieve one published Journal article with its body, verified sources and frequently asked questions.",
    httpPath: `${PUBLIC_API_BASE}/articles/{slug}`,
    backingTables: ["articles", "article_sources"],
    requiresStoreSync: false,
  },
  {
    key: "get_store_information",
    label: "Get store information",
    description:
      "Brand facts, contact routes and the list of published policies, including shipping and returns where they have been published.",
    httpPath: `${PUBLIC_API_BASE}/store`,
    backingTables: ["legal_documents"],
    requiresStoreSync: false,
  },
  {
    key: "get_policy",
    label: "Get policy document",
    description:
      "Retrieve one published policy document such as privacy, returns and refunds or shipping and delivery.",
    httpPath: `${PUBLIC_API_BASE}/policies/{slug}`,
    backingTables: ["legal_documents"],
    requiresStoreSync: false,
  },
  {
    key: "get_answers",
    label: "Get answerable questions",
    description:
      "Approved question and answer pairs attached to public products, categories and articles.",
    httpPath: `${PUBLIC_API_BASE}/answers`,
    backingTables: ["seo_records", "seo_questions"],
    requiresStoreSync: false,
  },
];
