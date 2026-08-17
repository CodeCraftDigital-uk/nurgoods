DROP POLICY IF EXISTS "Anyone can read duplicate members" ON public.duplicate_group_members;
DROP POLICY IF EXISTS "Anyone can read duplicate groups" ON public.duplicate_groups;

REVOKE SELECT ON public.duplicate_group_members FROM anon;
REVOKE SELECT ON public.duplicate_groups FROM anon;

GRANT ALL ON public.duplicate_group_members TO service_role;
GRANT ALL ON public.duplicate_groups TO service_role;

-- Storefront surfaces only need the suppression map, never the internal
-- evidence, pricing analysis or admin decisions. This definer function exposes
-- exactly that minimal projection.
CREATE OR REPLACE FUNCTION public.public_suppressed_products()
RETURNS TABLE (product_id uuid, canonical_handle text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.product_id, g.canonical_handle
  FROM public.duplicate_group_members m
  JOIN public.duplicate_groups g ON g.id = m.group_id
  WHERE m.suppressed = true
$$;

REVOKE ALL ON FUNCTION public.public_suppressed_products() FROM public;
GRANT EXECUTE ON FUNCTION public.public_suppressed_products() TO anon, authenticated, service_role;