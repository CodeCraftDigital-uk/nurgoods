REVOKE ALL ON FUNCTION public.claim_supplier_links(text, integer, integer) FROM authenticated;
REVOKE ALL ON FUNCTION public.supplier_sync_health(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_supplier_links(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.supplier_sync_health(integer) TO service_role;