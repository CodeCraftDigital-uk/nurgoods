GRANT SELECT ON public.legal_documents TO anon;
GRANT SELECT ON public.review_placements TO anon;
GRANT SELECT ON public.article_internal_links TO anon;

CREATE POLICY "Published policy documents are public"
ON public.legal_documents
FOR SELECT
TO anon, authenticated
USING (status = 'published'::workflow_status AND is_placeholder = false);

CREATE POLICY "Enabled review placements are public"
ON public.review_placements
FOR SELECT
TO anon, authenticated
USING (enabled = true);

CREATE POLICY "Accepted links on published articles are public"
ON public.article_internal_links
FOR SELECT
TO anon, authenticated
USING (
  accepted = true
  AND EXISTS (
    SELECT 1 FROM public.articles a
    WHERE a.id = article_internal_links.article_id
      AND a.status = 'published'::workflow_status
      AND a.published_at IS NOT NULL
  )
);