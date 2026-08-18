ALTER TABLE public.zendrop_pricing_settings
  ADD COLUMN IF NOT EXISTS fx_source text NOT NULL DEFAULT 'European Central Bank daily reference rates',
  ADD COLUMN IF NOT EXISTS fx_buffer_pct numeric NOT NULL DEFAULT 0.04,
  ADD COLUMN IF NOT EXISTS fx_quote_max_age_hours integer NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS shipping_quote_max_age_days integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS payment_fee_variable numeric NOT NULL DEFAULT 0.02,
  ADD COLUMN IF NOT EXISTS payment_fee_fixed numeric NOT NULL DEFAULT 0.25,
  ADD COLUMN IF NOT EXISTS free_shipping_market text NOT NULL DEFAULT 'GB';

ALTER TABLE public.pricing_audit_items
  ADD COLUMN IF NOT EXISTS supplier_currency text,
  ADD COLUMN IF NOT EXISTS supplier_item_cost_source numeric,
  ADD COLUMN IF NOT EXISTS supplier_shipping_source_amount numeric,
  ADD COLUMN IF NOT EXISTS supplier_additional_cost numeric,
  ADD COLUMN IF NOT EXISTS supplier_landed_total_source numeric,
  ADD COLUMN IF NOT EXISTS fx_reference_rate numeric,
  ADD COLUMN IF NOT EXISTS fx_source text,
  ADD COLUMN IF NOT EXISTS fx_as_of text,
  ADD COLUMN IF NOT EXISTS fx_buffer_pct numeric,
  ADD COLUMN IF NOT EXISTS fx_effective_rate numeric,
  ADD COLUMN IF NOT EXISTS protected_landed_cogs numeric,
  ADD COLUMN IF NOT EXISTS fee_variable numeric,
  ADD COLUMN IF NOT EXISTS fee_fixed numeric,
  ADD COLUMN IF NOT EXISTS required_price numeric,
  ADD COLUMN IF NOT EXISTS expected_fee numeric,
  ADD COLUMN IF NOT EXISTS expected_payout numeric,
  ADD COLUMN IF NOT EXISTS expected_profit numeric,
  ADD COLUMN IF NOT EXISTS expected_margin numeric,
  ADD COLUMN IF NOT EXISTS promo_price numeric,
  ADD COLUMN IF NOT EXISTS promo_profit numeric,
  ADD COLUMN IF NOT EXISTS promo_margin numeric,
  ADD COLUMN IF NOT EXISTS promo_within_floor boolean,
  ADD COLUMN IF NOT EXISTS shipping_service text,
  ADD COLUMN IF NOT EXISTS shipping_destination text,
  ADD COLUMN IF NOT EXISTS shipping_quoted_at timestamptz,
  ADD COLUMN IF NOT EXISTS evidence_status text;

ALTER TABLE public.product_supplier_links
  ADD COLUMN IF NOT EXISTS shipping_service text,
  ADD COLUMN IF NOT EXISTS shipping_destination text,
  ADD COLUMN IF NOT EXISTS shipping_quoted_at timestamptz;

ALTER TABLE public.commerce_orders
  ADD COLUMN IF NOT EXISTS actual_gross_payment numeric,
  ADD COLUMN IF NOT EXISTS actual_payment_fee numeric,
  ADD COLUMN IF NOT EXISTS actual_payout numeric,
  ADD COLUMN IF NOT EXISTS actual_supplier_cost_source numeric,
  ADD COLUMN IF NOT EXISTS actual_supplier_cost_settlement numeric,
  ADD COLUMN IF NOT EXISTS realised_fx_rate numeric,
  ADD COLUMN IF NOT EXISTS realised_profit numeric,
  ADD COLUMN IF NOT EXISTS realised_margin numeric,
  ADD COLUMN IF NOT EXISTS forecast_profit numeric,
  ADD COLUMN IF NOT EXISTS forecast_margin numeric,
  ADD COLUMN IF NOT EXISTS profit_variance numeric,
  ADD COLUMN IF NOT EXISTS fulfilment_mode text,
  ADD COLUMN IF NOT EXISTS economics_note text;

ALTER TABLE public.commerce_order_lines
  ADD COLUMN IF NOT EXISTS supplier_only boolean NOT NULL DEFAULT false;

UPDATE public.commerce_orders
SET actual_gross_payment = 8.99,
    actual_payment_fee = 0.43,
    actual_payout = 8.56,
    actual_supplier_cost_source = 5.61,
    actual_supplier_cost_settlement = 4.27,
    realised_fx_rate = round(4.27 / 5.61, 6),
    realised_profit = 4.29,
    realised_margin = round(4.29 / 8.99, 6),
    fulfilment_mode = 'manual_external',
    economics_note = 'Fulfilled manually in the supplier portal by the owner. Customer paid GBP 8.99, card processing fee GBP 0.43, payout GBP 8.56. Supplier cost USD 5.61 charged as GBP 4.27 on the registered card.'
WHERE shopify_order_name = '#1001';