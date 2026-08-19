ALTER TABLE public.zendrop_sourcing_rules
  ADD COLUMN IF NOT EXISTS scan_page integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS scan_cursor text,
  ADD COLUMN IF NOT EXISTS scan_cycle integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS scan_pages_per_run integer NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS scan_last_at timestamptz,
  ADD COLUMN IF NOT EXISTS scan_exhausted_at timestamptz,
  ADD COLUMN IF NOT EXISTS discovery_market_mode text NOT NULL DEFAULT 'any';

ALTER TABLE public.product_supplier_links
  ADD COLUMN IF NOT EXISTS supplier_status text,
  ADD COLUMN IF NOT EXISTS supplier_available boolean,
  ADD COLUMN IF NOT EXISTS supplier_inventory integer,
  ADD COLUMN IF NOT EXISTS last_supplier_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS sync_state text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS sync_reason text,
  ADD COLUMN IF NOT EXISTS consecutive_sync_failures integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS product_supplier_links_sync_idx
  ON public.product_supplier_links (last_supplier_sync_at NULLS FIRST);

INSERT INTO public.automation_jobs (job_key, label, description, job_type, enabled, schedule_cron, config)
VALUES (
  'supplier_product_refresh',
  'Supplier product refresh',
  'Re-reads supplier cost, availability and shipping for products already on sale, repricing or pulling them from sale when the supplier evidence changes or goes stale.',
  'commerce',
  true,
  '17,47 * * * *',
  '{"batch_size": 25}'::jsonb
)
ON CONFLICT (job_key) DO NOTHING;