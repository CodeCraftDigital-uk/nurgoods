REVOKE ALL ON FUNCTION public.refresh_storefront_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_storefront_snapshot() TO service_role;

REVOKE ALL ON FUNCTION public.recover_stale_automation_runs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_stale_automation_runs(integer) TO service_role;