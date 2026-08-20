-- Published policy overrides must be readable by visitors so approved wording
-- replaces imported store wording on the public policy pages.
CREATE POLICY "Published policy overrides are public"
ON public.legal_source_overrides
FOR SELECT
TO anon, authenticated
USING (published_body_html IS NOT NULL);

-- Policies that can only be read authoritatively on the store are exposed as
-- a title and link only. A definer function keeps the body text private.
CREATE OR REPLACE FUNCTION public.public_legal_references()
RETURNS TABLE (slug text, title text, source_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.slug, s.title, s.source_url
  FROM public.shopify_legal_sources s
  WHERE s.is_published = true
    AND s.public_visible = false
    AND s.has_liquid = true
    AND s.has_placeholders = false
    AND s.source_url IS NOT NULL
    AND s.source_url <> ''
    AND NOT EXISTS (
      SELECT 1 FROM public.legal_source_overrides o
      WHERE o.source_id = s.id AND o.published_body_html IS NOT NULL
    );
$$;

GRANT EXECUTE ON FUNCTION public.public_legal_references() TO anon, authenticated;