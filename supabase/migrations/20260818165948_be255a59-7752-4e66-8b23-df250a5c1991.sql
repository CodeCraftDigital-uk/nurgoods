ALTER TABLE public.commerce_orders
  ADD COLUMN IF NOT EXISTS supplier_currency text,
  ADD COLUMN IF NOT EXISTS supplier_product_cost numeric,
  ADD COLUMN IF NOT EXISTS supplier_shipping_cost numeric,
  ADD COLUMN IF NOT EXISTS supplier_fees numeric,
  ADD COLUMN IF NOT EXISTS supplier_total numeric,
  ADD COLUMN IF NOT EXISTS supplier_payment_amount numeric,
  ADD COLUMN IF NOT EXISTS supplier_payment_currency text;

UPDATE public.commerce_orders
SET supplier_currency = 'USD',
    supplier_product_cost = 1.09,
    supplier_shipping_cost = 4.32,
    supplier_fees = 0.20,
    supplier_total = 5.61,
    supplier_payment_amount = 4.27,
    supplier_payment_currency = 'GBP'
WHERE shopify_order_id = 'gid://shopify/Order/18060977275210'
  AND zendrop_order_id = 44666543
  AND supplier_total IS NULL;