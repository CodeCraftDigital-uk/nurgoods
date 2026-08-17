-- Storefront category lookup: only product_id and category_slug ever leave the table.
CREATE OR REPLACE FUNCTION public.public_product_categories()
RETURNS TABLE(product_id uuid, category_slug text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.product_id, c.category_slug
  FROM public.product_classifications c
  WHERE c.auto_published = true
    AND c.category_slug IS NOT NULL
$$;

REVOKE ALL ON FUNCTION public.public_product_categories() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_product_categories() TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Public category lookup only" ON public.product_classifications;
REVOKE ALL ON TABLE public.product_classifications FROM anon;

DROP POLICY IF EXISTS "Anyone can read published legal overrides" ON public.legal_source_overrides;
REVOKE ALL ON TABLE public.legal_source_overrides FROM anon;