CREATE OR REPLACE FUNCTION public.hidden_intake_product_ids()
RETURNS TABLE (product_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.product_id
  FROM public.product_intake_records r
  WHERE r.product_id IS NOT NULL
    AND r.state <> 'published_to_storefront'
$$;

GRANT EXECUTE ON FUNCTION public.hidden_intake_product_ids() TO anon, authenticated, service_role;