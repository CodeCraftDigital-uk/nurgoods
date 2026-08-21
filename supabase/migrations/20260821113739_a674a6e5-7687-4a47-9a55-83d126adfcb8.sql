REVOKE EXECUTE ON FUNCTION public.pricing_gate_stats() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pricing_gate_stats() FROM anon;
REVOKE EXECUTE ON FUNCTION public.pricing_gate_stats() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.pricing_gate_stats() TO service_role;