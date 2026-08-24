ALTER TABLE public.product_supplier_links
  ADD COLUMN IF NOT EXISTS shipping_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS shipping_attempt_cycle integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS product_supplier_links_shipping_cycle_idx
  ON public.product_supplier_links (shipping_attempt_cycle, id);