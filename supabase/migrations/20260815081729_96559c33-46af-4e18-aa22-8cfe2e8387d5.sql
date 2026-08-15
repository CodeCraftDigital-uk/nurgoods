
-- Public, read-only window for the connector surface. Column-level grants keep
-- raw payloads and internal notes out of reach even if a policy widens later.

-- Products: only active, successfully synced rows.
CREATE POLICY "Active synced products are public"
  ON public.shopify_products FOR SELECT TO anon, authenticated
  USING (status = 'active' AND sync_status = 'synced');

REVOKE SELECT ON public.shopify_products FROM anon;
GRANT SELECT (id, shopify_product_id, handle, title, product_type, vendor, tags,
              featured_image_url, price_min, price_max, currency, status,
              variant_count, sync_status, shopify_updated_at, last_synced_at, updated_at)
  ON public.shopify_products TO anon;

-- Collections: only successfully synced rows.
CREATE POLICY "Synced collections are public"
  ON public.shopify_collections FOR SELECT TO anon, authenticated
  USING (sync_status = 'synced');

REVOKE SELECT ON public.shopify_collections FROM anon;
GRANT SELECT (id, shopify_collection_id, handle, title, description, image_url,
              product_count, sync_status, shopify_updated_at, last_synced_at, updated_at)
  ON public.shopify_collections TO anon;

-- Product enrichment: only published editorial content, and only if the product
-- itself is publicly visible.
CREATE POLICY "Published product content is public"
  ON public.product_enrichment FOR SELECT TO anon, authenticated
  USING (
    status = 'published'
    AND EXISTS (
      SELECT 1 FROM public.shopify_products p
      WHERE p.id = product_enrichment.product_id
        AND p.status = 'active'
        AND p.sync_status = 'synced'
    )
  );

REVOKE SELECT ON public.product_enrichment FROM anon;
GRANT SELECT (id, product_id, summary, long_description, benefits, use_cases,
              specifications, delivery_information, care_information, faqs,
              status, updated_at)
  ON public.product_enrichment TO anon;

-- Approved answerable questions attached to published content only.
CREATE OR REPLACE FUNCTION public.seo_record_is_public(_record_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.seo_records r
    LEFT JOIN public.articles a
      ON r.target_type = 'article' AND a.slug = r.target_reference
    LEFT JOIN public.shopify_products p
      ON r.target_type = 'product' AND p.handle = r.target_reference
    LEFT JOIN public.shopify_collections c
      ON r.target_type = 'collection' AND c.handle = r.target_reference
    WHERE r.id = _record_id
      AND (
        (a.id IS NOT NULL AND a.status = 'published' AND a.published_at IS NOT NULL)
        OR (p.id IS NOT NULL AND p.status = 'active' AND p.sync_status = 'synced')
        OR (c.id IS NOT NULL AND c.sync_status = 'synced')
      )
  )
$$;

CREATE POLICY "Approved questions on public content are public"
  ON public.seo_questions FOR SELECT TO anon, authenticated
  USING (include_in_faq_schema = true AND public.seo_record_is_public(seo_record_id));

REVOKE SELECT ON public.seo_questions FROM anon;
GRANT SELECT (id, seo_record_id, question, answer, include_in_faq_schema, source_url, updated_at)
  ON public.seo_questions TO anon;

-- The connector needs to know which record maps to which target.
CREATE POLICY "Public seo record targets are readable"
  ON public.seo_records FOR SELECT TO anon, authenticated
  USING (public.seo_record_is_public(id));

REVOKE SELECT ON public.seo_records FROM anon;
GRANT SELECT (id, target_type, target_reference, target_label, updated_at) ON public.seo_records TO anon;
