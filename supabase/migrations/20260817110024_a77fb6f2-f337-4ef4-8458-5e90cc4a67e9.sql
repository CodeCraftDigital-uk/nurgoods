-- Public category lookup: standard (invoker) view + column limited access
ALTER VIEW public.public_product_categories SET (security_invoker = true);

GRANT SELECT (product_id, category_slug) ON public.product_classifications TO anon;

CREATE POLICY "Public category lookup only"
ON public.product_classifications
FOR SELECT
TO anon
USING (auto_published = true AND category_slug IS NOT NULL);

-- Ensure the price range helpers are not reachable from the Data API
REVOKE ALL ON FUNCTION public.refresh_product_price_range(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_product_price_range() FROM PUBLIC, anon, authenticated;