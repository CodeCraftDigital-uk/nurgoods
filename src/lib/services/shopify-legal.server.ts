/**
 * Legal and policy synchronisation from the connected store.
 *
 * This reuses the existing client credentials pairing and short lived Admin API
 * token from shopify.server.ts. No separate authentication is introduced here.
 * The store stays the source of truth. Nothing is written back to the store and
 * no missing wording is ever invented locally.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  POLICY_TYPE_SLUGS,
  POLICY_TYPE_TITLES,
  decideVisibility,
  detectLiquid,
  detectPlaceholders,
  slugify,
  textLength,
} from "@/lib/legal/source-content";

/** Admin API scopes this sync needs, beyond the catalogue scopes. */
export const LEGAL_SCOPES = ["read_legal_policies", "read_content", "read_online_store_pages"];

export interface LegalSyncResult {
  policies: number;
  pages: number;
  imported: number;
  publicVisible: number;
  needsReview: number;
  skipped: number;
  syncedAt: string;
  /** Present when the installed app version does not grant the legal scopes. */
  scopeAction: string | null;
}

const POLICIES_QUERY = /* GraphQL */ `
  query NurGoodsShopPolicies {
    shop {
      name
      shopPolicies {
        id
        type
        title
        body
        url
        createdAt
        updatedAt
      }
    }
  }
`;

const PAGES_QUERY = /* GraphQL */ `
  query NurGoodsPages($cursor: String) {
    pages(first: 50, after: $cursor, query: "published_status:published") {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        handle
        body
        bodySummary
        isPublished
        publishedAt
        createdAt
        updatedAt
        templateSuffix
      }
    }
  }
`;

type ShopPolicy = {
  id: string;
  type: string | null;
  title: string | null;
  body: string | null;
  url: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type ShopifyPage = {
  id: string;
  title: string;
  handle: string;
  body: string | null;
  bodySummary: string | null;
  isPublished: boolean | null;
  publishedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  templateSuffix: string | null;
};

function isScopeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /403|access denied|scope|not approved|permission/i.test(message);
}

export const LEGAL_SCOPE_ACTION =
  "The installed app version does not grant read_legal_policies, read_content and read_online_store_pages. Add those scopes to the app, release a new version, then reinstall it on this store.";

function toRow(input: {
  sourceType: "shop_policy" | "shopify_page";
  shopifyId: string;
  policyType: string | null;
  title: string;
  handle: string | null;
  slug: string;
  body: string;
  summary: string | null;
  sourceUrl: string | null;
  isPublished: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  publishedAt: string | null;
  syncedAt: string;
}) {
  const liquid = detectLiquid(input.body);
  const placeholders = detectPlaceholders(input.body);
  const decision = decideVisibility({
    isPublished: input.isPublished,
    hasLiquid: liquid.length > 0,
    hasPlaceholders: placeholders.length > 0,
    bodyLength: textLength(input.body),
  });

  return {
    source_type: input.sourceType,
    shopify_id: input.shopifyId,
    policy_type: input.policyType,
    title: input.title,
    handle: input.handle,
    slug: input.slug,
    body_html: input.body,
    body_summary: input.summary,
    source_url: input.sourceUrl,
    is_published: input.isPublished,
    shopify_created_at: input.createdAt,
    shopify_updated_at: input.updatedAt,
    shopify_published_at: input.publishedAt,
    last_synced_at: input.syncedAt,
    sync_status: "synced" as const,
    sync_error: null,
    has_liquid: liquid.length > 0,
    liquid_tokens: liquid,
    has_placeholders: placeholders.length > 0,
    placeholder_tokens: placeholders,
    review_status: decision.reviewStatus,
    public_visible: decision.publicVisible,
    exclude_reason: decision.excludeReason,
  };
}

/**
 * Fetches native store policies and published online store pages, then upserts
 * them deterministically on the Shopify identifier so repeated runs never
 * duplicate a document.
 */
export async function syncLegalContent(
  _supabase?: SupabaseClient<any, "public", any>,
): Promise<LegalSyncResult> {
  // Imported legal records are written with the privileged server client: the
  // signed in role has read only access to this mirror by design.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const supabase = supabaseAdmin as unknown as SupabaseClient<any, "public", any>;
  const {
    resolveShopifyCredentials,
    getAdminAccessToken,
    shopifyGraphql,
  } = await import("./shopify.server");

  const resolved = await resolveShopifyCredentials();
  if (!resolved.shopDomain || resolved.missing.length > 0) {
    throw new Error(`Store credentials missing: ${resolved.missing.join(", ")}`);
  }
  const adminToken = await getAdminAccessToken(resolved);
  const credentials = {
    shopDomain: resolved.shopDomain,
    adminToken,
    apiVersion: resolved.apiVersion,
  };

  const syncedAt = new Date().toISOString();
  let scopeAction: string | null = null;
  const rows: ReturnType<typeof toRow>[] = [];
  let policyCount = 0;
  let pageCount = 0;
  let skipped = 0;

  // Native store policies.
  try {
    const data = await shopifyGraphql<{ shop: { shopPolicies: ShopPolicy[] | null } }>(
      credentials,
      POLICIES_QUERY,
    );
    const policies = data.shop?.shopPolicies ?? [];
    for (const policy of policies) {
      const body = policy.body ?? "";
      if (!policy.id) continue;
      if (textLength(body) === 0) {
        skipped += 1;
        continue;
      }
      const type = policy.type ?? "";
      const slug = POLICY_TYPE_SLUGS[type] ?? slugify(policy.title ?? type ?? policy.id);
      rows.push(
        toRow({
          sourceType: "shop_policy",
          shopifyId: policy.id,
          policyType: type || null,
          title: policy.title || POLICY_TYPE_TITLES[type] || "Store policy",
          handle: null,
          slug,
          body,
          summary: null,
          sourceUrl: policy.url ?? null,
          isPublished: true,
          createdAt: policy.createdAt ?? null,
          updatedAt: policy.updatedAt ?? null,
          publishedAt: policy.createdAt ?? null,
          syncedAt,
        }),
      );
      policyCount += 1;
    }
  } catch (error) {
    if (!isScopeError(error)) throw error;
    scopeAction = LEGAL_SCOPE_ACTION;
  }

  // Published online store pages.
  try {
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const data: any = await shopifyGraphql(credentials, PAGES_QUERY, { cursor });
      const nodes = (data.pages?.nodes ?? []) as ShopifyPage[];
      for (const node of nodes) {
        if (node.isPublished === false) {
          skipped += 1;
          continue;
        }
        const body = node.body ?? "";
        rows.push(
          toRow({
            sourceType: "shopify_page",
            shopifyId: node.id,
            policyType: node.templateSuffix ?? null,
            title: node.title,
            handle: node.handle,
            slug: slugify(node.handle || node.title),
            body,
            summary: node.bodySummary ?? null,
            sourceUrl: `https://${resolved.shopDomain}/pages/${node.handle}`,
            isPublished: node.isPublished ?? true,
            createdAt: node.createdAt ?? null,
            updatedAt: node.updatedAt ?? null,
            publishedAt: node.publishedAt ?? null,
            syncedAt,
          }),
        );
        pageCount += 1;
      }
      if (!data.pages?.pageInfo?.hasNextPage) break;
      cursor = data.pages.pageInfo.endCursor;
    }
  } catch (error) {
    if (!isScopeError(error)) throw error;
    scopeAction = LEGAL_SCOPE_ACTION;
  }

  // Deduplicate slugs deterministically: native policies win over pages.
  const bySlug = new Map<string, ReturnType<typeof toRow>>();
  for (const row of rows.sort((a, b) => (a.source_type === "shop_policy" ? -1 : 1))) {
    const existing = bySlug.get(row.slug);
    if (!existing) {
      bySlug.set(row.slug, row);
      continue;
    }
    row.slug = `${row.slug}-${row.source_type === "shop_policy" ? "policy" : "page"}`;
    bySlug.set(row.slug, row);
  }
  const finalRows = [...bySlug.values()];

  if (finalRows.length > 0) {
    const { error } = await supabase
      .from("shopify_legal_sources")
      .upsert(finalRows, { onConflict: "shopify_id" });
    if (error) throw new Error(error.message);
  }

  return {
    policies: policyCount,
    pages: pageCount,
    imported: finalRows.length,
    publicVisible: finalRows.filter((row) => row.public_visible).length,
    needsReview: finalRows.filter((row) => row.review_status === "needs_review").length,
    skipped,
    syncedAt,
    scopeAction,
  };
}
