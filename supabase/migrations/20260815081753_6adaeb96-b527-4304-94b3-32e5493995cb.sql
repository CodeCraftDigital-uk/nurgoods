
DROP POLICY "Approved questions on public content are public" ON public.seo_questions;
DROP POLICY "Public seo record targets are readable" ON public.seo_records;
DROP FUNCTION IF EXISTS public.seo_record_is_public(uuid);

CREATE POLICY "Public seo record targets are readable"
  ON public.seo_records FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.articles a
      WHERE seo_records.target_type = 'article' AND a.slug = seo_records.target_reference
        AND a.status = 'published' AND a.published_at IS NOT NULL
    )
    OR EXISTS (
      SELECT 1 FROM public.shopify_products p
      WHERE seo_records.target_type = 'product' AND p.handle = seo_records.target_reference
        AND p.status = 'active' AND p.sync_status = 'synced'
    )
    OR EXISTS (
      SELECT 1 FROM public.shopify_collections c
      WHERE seo_records.target_type = 'collection' AND c.handle = seo_records.target_reference
        AND c.sync_status = 'synced'
    )
  );

CREATE POLICY "Approved questions on public content are public"
  ON public.seo_questions FOR SELECT TO anon, authenticated
  USING (
    include_in_faq_schema = true
    AND EXISTS (
      SELECT 1 FROM public.seo_records r WHERE r.id = seo_questions.seo_record_id
    )
  );
