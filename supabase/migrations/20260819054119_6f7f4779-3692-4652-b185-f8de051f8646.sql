ALTER TABLE public.product_supplier_links
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS held_at timestamptz,
  ADD COLUMN IF NOT EXISTS held_reason text,
  ADD COLUMN IF NOT EXISTS recovered_at timestamptz,
  ADD COLUMN IF NOT EXISTS manual_hold boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS supplier_cost numeric,
  ADD COLUMN IF NOT EXISTS supplier_cost_currency text,
  ADD COLUMN IF NOT EXISTS landed_cost numeric,
  ADD COLUMN IF NOT EXISTS variant_stock jsonb,
  ADD COLUMN IF NOT EXISTS variant_map_synced_at timestamptz;

CREATE INDEX IF NOT EXISTS product_supplier_links_claim_idx
  ON public.product_supplier_links (lease_expires_at, next_retry_at, last_supplier_sync_at NULLS FIRST);

CREATE INDEX IF NOT EXISTS product_supplier_links_sync_state_idx
  ON public.product_supplier_links (sync_state);

ALTER TABLE public.zendrop_sourcing_rules
  ADD COLUMN IF NOT EXISTS freshness_target_hours integer NOT NULL DEFAULT 48,
  ADD COLUMN IF NOT EXISTS refresh_min_batch integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS refresh_max_batch integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS refresh_headroom_pct numeric NOT NULL DEFAULT 0.30,
  ADD COLUMN IF NOT EXISTS refresh_runs_per_hour integer NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS auto_recovery_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS inventory_policy_override boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.claim_supplier_links(
  _owner text,
  _batch integer,
  _lease_seconds integer DEFAULT 600
)
RETURNS SETOF public.product_supplier_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.product_supplier_links l
     SET lease_owner = _owner,
         lease_expires_at = now() + make_interval(secs => GREATEST(60, _lease_seconds)),
         updated_at = now()
   WHERE l.id IN (
     SELECT c.id
       FROM public.product_supplier_links c
      WHERE c.supplier_product_id IS NOT NULL
        AND (c.lease_expires_at IS NULL OR c.lease_expires_at < now())
        AND (c.next_retry_at IS NULL OR c.next_retry_at <= now())
      ORDER BY c.last_supplier_sync_at ASC NULLS FIRST
      LIMIT GREATEST(1, _batch)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING l.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.supplier_sync_health(_stale_hours integer DEFAULT 72)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM public.product_supplier_links WHERE supplier_product_id IS NOT NULL),
    'by_state', COALESCE((
      SELECT jsonb_object_agg(state, n) FROM (
        SELECT COALESCE(sync_state, 'pending') AS state, count(*) AS n
          FROM public.product_supplier_links
         WHERE supplier_product_id IS NOT NULL
         GROUP BY 1
      ) s
    ), '{}'::jsonb),
    'stale', (
      SELECT count(*) FROM public.product_supplier_links
       WHERE supplier_product_id IS NOT NULL
         AND (last_supplier_sync_at IS NULL
              OR last_supplier_sync_at < now() - make_interval(hours => GREATEST(1, _stale_hours))))
    ,
    'variant_mapped', (
      SELECT count(*) FROM public.product_supplier_links
       WHERE supplier_product_id IS NOT NULL
         AND variant_map IS NOT NULL
         AND jsonb_typeof(variant_map) = 'array'
         AND jsonb_array_length(variant_map) > 0),
    'variant_unmapped', (
      SELECT count(*) FROM public.product_supplier_links
       WHERE supplier_product_id IS NOT NULL
         AND (variant_map IS NULL
              OR jsonb_typeof(variant_map) <> 'array'
              OR jsonb_array_length(variant_map) = 0)),
    'manual_holds', (
      SELECT count(*) FROM public.product_supplier_links
       WHERE supplier_product_id IS NOT NULL AND manual_hold = true),
    'leased', (
      SELECT count(*) FROM public.product_supplier_links
       WHERE supplier_product_id IS NOT NULL AND lease_expires_at IS NOT NULL AND lease_expires_at > now()),
    'retrying', (
      SELECT count(*) FROM public.product_supplier_links
       WHERE supplier_product_id IS NOT NULL AND retry_count > 0),
    'never_synced', (
      SELECT count(*) FROM public.product_supplier_links
       WHERE supplier_product_id IS NOT NULL AND last_supplier_sync_at IS NULL),
    'oldest_fact_hours', (
      SELECT COALESCE(round(EXTRACT(epoch FROM (now() - min(last_supplier_sync_at))) / 3600.0)::int, -1)
        FROM public.product_supplier_links
       WHERE supplier_product_id IS NOT NULL AND last_supplier_sync_at IS NOT NULL)
  );
$$;

REVOKE ALL ON FUNCTION public.claim_supplier_links(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_supplier_links(text, integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.supplier_sync_health(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.supplier_sync_health(integer) TO authenticated, service_role;