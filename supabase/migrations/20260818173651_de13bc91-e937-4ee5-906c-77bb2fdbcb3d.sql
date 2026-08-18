ALTER TABLE public.product_price_revisions
  ADD COLUMN IF NOT EXISTS supplier_currency text,
  ADD COLUMN IF NOT EXISTS supplier_landed_total_source numeric(12,4),
  ADD COLUMN IF NOT EXISTS fx_reference_rate numeric(14,6),
  ADD COLUMN IF NOT EXISTS fx_source text,
  ADD COLUMN IF NOT EXISTS fx_as_of text,
  ADD COLUMN IF NOT EXISTS fx_buffer_pct numeric(6,4),
  ADD COLUMN IF NOT EXISTS fx_effective_rate numeric(14,6),
  ADD COLUMN IF NOT EXISTS protected_landed_cogs numeric(12,2),
  ADD COLUMN IF NOT EXISTS fee_variable numeric(6,4),
  ADD COLUMN IF NOT EXISTS fee_fixed numeric(10,2),
  ADD COLUMN IF NOT EXISTS required_price numeric(12,4),
  ADD COLUMN IF NOT EXISTS expected_fee numeric(10,2),
  ADD COLUMN IF NOT EXISTS expected_payout numeric(12,2),
  ADD COLUMN IF NOT EXISTS expected_profit numeric(12,2),
  ADD COLUMN IF NOT EXISTS expected_margin numeric(6,4),
  ADD COLUMN IF NOT EXISTS shipping_service text,
  ADD COLUMN IF NOT EXISTS shipping_destination text,
  ADD COLUMN IF NOT EXISTS shipping_quoted_at timestamptz;

ALTER TABLE public.zendrop_pricing_settings
  ALTER COLUMN fx_quote_max_age_hours SET DEFAULT 72;

UPDATE public.zendrop_pricing_settings
  SET fx_quote_max_age_hours = 72
  WHERE fx_quote_max_age_hours = 24;