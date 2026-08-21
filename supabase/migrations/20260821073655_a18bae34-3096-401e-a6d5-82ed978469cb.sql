ALTER TABLE public.product_price_authority
  ADD COLUMN IF NOT EXISTS inventory_item_id text,
  ADD COLUMN IF NOT EXISTS unit_cost numeric(12,2),
  ADD COLUMN IF NOT EXISTS input_hash text,
  ADD COLUMN IF NOT EXISTS last_app_write_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS cost_observed_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS product_price_authority_hash_idx
  ON public.product_price_authority (shopify_variant_id, input_hash);

UPDATE public.automation_jobs
  SET enabled = false,
      last_result = jsonb_build_object('message', 'Retired: Zendrop now pre-filters deliverability before Shopify, and Shopify is the catalogue source of truth.')
  WHERE job_key IN ('supplier_sourcing_hourly', 'supplier_link_recovery', 'sellability_hold_sweep');

UPDATE public.automation_jobs
  SET schedule_cron = '*/10 * * * *'
  WHERE job_key = 'price_authority_sync';

CREATE TABLE IF NOT EXISTS public.pricing_backfill_state (
  id text PRIMARY KEY,
  cursor text,
  variants_seen integer NOT NULL DEFAULT 0,
  variants_priced integer NOT NULL DEFAULT 0,
  variants_held integer NOT NULL DEFAULT 0,
  completed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.pricing_backfill_state TO authenticated;
GRANT ALL ON public.pricing_backfill_state TO service_role;

ALTER TABLE public.pricing_backfill_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can review the pricing backfill"
  ON public.pricing_backfill_state
  FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'staff'::app_role)
    OR has_role(auth.uid(), 'viewer'::app_role)
  );

CREATE TRIGGER update_pricing_backfill_state_updated_at
  BEFORE UPDATE ON public.pricing_backfill_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();