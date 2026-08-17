/**
 * Data access for the public read only connector.
 *
 * Reads run through the publishable key, so row level security is the security
 * boundary: only products the store has published as active and synced are
 * visible, exactly as they are to an anonymous visitor on the public shop.
 * Every record is then narrowed by the field allowlist before it leaves the
 * server.
 */
import { BRAND } from "@/lib/brand";
import { isProhibitedRow } from "@/lib/policy/prohibited";
import { publicClient, searchProducts, type PublicProduct } from "./queries.server";
import {
  findForbiddenKey,
  projectDetail,
  projectSummary,
  type ConnectorProductDetail,
  type ConnectorProductSummary,
} from "./connector-fields";

/** Canonical page a shopper should be sent to for a product. */
export function productPageUrl(handle: string): string {
  return `${BRAND.siteUrl}/shop/${handle}`;
}

/** Final guard. A payload carrying a non public key is never returned. */
function guard<T>(payload: T): T {
  const found = findForbiddenKey(payload);
  if (found) {
    throw new Error(`Connector payload blocked: field "${found}" is not public.`);
  }
  return payload;
}

export async function connectorSearchProducts(input: {
  query?: string | undefined;
  category?: string | undefined;
  product_type?: string | undefined;
  tag?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}): Promise<{ items: ConnectorProductSummary[]; page: { limit: number; offset: number; count: number; has_more: boolean } }> {
  const result = await searchProducts({
    query: input.query,
    category: input.category,
    productType: input.product_type,
    tag: input.tag,
    limit: input.limit,
    offset: input.offset,
  });
  const items = result.items.map((item: PublicProduct) =>
    projectSummary(
      {
        handle: item.handle,
        title: item.title,
        summary: item.summary ?? null,
        product_type: item.product_type,
        vendor: item.vendor,
        tags: item.tags,
        image_url: item.image_url,
        price_min: item.price.min,
        price_max: item.price.max,
        currency: item.price.currency,
        variant_count: item.variant_count,
      },
      productPageUrl(item.handle),
    ),
  );
  return guard({ items, page: result.page });
}

const PRODUCT_COLUMNS =
  "id, handle, title, product_type, vendor, tags, featured_image_url, price_min, price_max, currency, available_for_sale, variant_count, description, options, shopify_updated_at";

export async function connectorGetProduct(handle: string): Promise<ConnectorProductDetail | null> {
  const supabase = await publicClient();
  const { data, error } = await supabase
    .from("shopify_products")
    .select(PRODUCT_COLUMNS)
    .eq("handle", handle)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as Record<string, any>;

  // Prohibited categories never resolve, even from a stale mirror row.
  if (isProhibitedRow(row as any)) return null;

  // A de-duplicated listing resolves to the record customers actually see.
  const { data: suppressed } = await supabase.rpc("public_suppressed_products");
  const member = ((suppressed ?? []) as any[]).find((r) => r.product_id === row["id"]);
  if (member) {
    const canonicalHandle = member.canonical_handle as string | null | undefined;
    if (canonicalHandle && canonicalHandle !== handle) return connectorGetProduct(canonicalHandle);
    return null;
  }

  const [{ data: enrichment }, { data: mediaRows }, { data: variantRows }, { data: joins }] =
    await Promise.all([
      supabase
        .from("product_enrichment")
        .select(
          "summary, long_description, benefits, use_cases, specifications, delivery_information, care_information, faqs, updated_at",
        )
        .eq("product_id", row["id"])
        .maybeSingle(),
      supabase
        .from("shopify_product_media")
        .select("url, alt_text, position")
        .eq("product_id", row["id"])
        .order("position", { ascending: true })
        .limit(12),
      supabase
        .from("shopify_product_variants")
        .select("title, price, currency, image_url, selected_options, available_for_sale, position")
        .eq("product_id", row["id"])
        .order("position", { ascending: true })
        .limit(100),
      supabase.from("shopify_product_collections").select("collection_id").eq("product_id", row["id"]),
    ]);

  const content = (enrichment ?? {}) as Record<string, any>;

  let collections: { title: string }[] = [];
  const collectionIds = ((joins ?? []) as any[]).map((j) => j.collection_id);
  if (collectionIds.length > 0) {
    const { data: rows } = await supabase
      .from("shopify_collections")
      .select("title")
      .in("id", collectionIds);
    collections = ((rows ?? []) as any[]).map((c) => ({ title: c.title }));
  }

  const detail = projectDetail(
    {
      handle: row["handle"],
      title: row["title"],
      summary: content["summary"] ?? null,
      product_type: row["product_type"],
      vendor: row["vendor"],
      tags: row["tags"],
      featured_image_url: row["featured_image_url"],
      price_min: row["price_min"],
      price_max: row["price_max"],
      currency: row["currency"],
      available_for_sale: row["available_for_sale"],
      variant_count: row["variant_count"],
      description: content["long_description"] ?? row["description"] ?? null,
      benefits: content["benefits"],
      use_cases: content["use_cases"],
      specifications: content["specifications"],
      delivery_information: content["delivery_information"],
      care_information: content["care_information"],
      faqs: content["faqs"],
      collections,
      media: ((mediaRows ?? []) as any[]).map((m) => ({ url: m.url, alt: m.alt_text ?? null })),
      options: row["options"],
      variants: variantRows ?? [],
      updated_at: row["shopify_updated_at"] ?? null,
    },
    productPageUrl(handle),
  );

  return guard(detail);
}
