ALTER TABLE public.product_intake_records
  ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'store',
  ADD COLUMN IF NOT EXISTS material_fingerprint text;

CREATE TABLE IF NOT EXISTS public.commerce_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_order_id text NOT NULL UNIQUE,
  shopify_order_name text,
  shopify_order_number integer,
  shopify_financial_status text,
  shopify_fulfillment_status text,
  currency text,
  order_total numeric(12,2),
  shipping_country text,
  shipping_city text,
  line_count integer NOT NULL DEFAULT 0,
  zendrop_store_id integer,
  zendrop_order_id integer,
  zendrop_order_number text,
  zendrop_fulfillment_operation_id text,
  orchestration_state text NOT NULL DEFAULT 'payment_not_confirmed',
  supplier_status text,
  tracking_number text,
  tracking_carrier text,
  tracking_url text,
  fulfilment_cost numeric(12,2),
  product_cost numeric(12,2),
  shipping_cost numeric(12,2),
  gross_margin numeric(12,2),
  preview_payload jsonb,
  preview_at timestamptz,
  preview_is_credit_redeem boolean NOT NULL DEFAULT false,
  dispatch_idempotency_key text,
  last_error text,
  retry_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  submitted_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz
);
CREATE INDEX IF NOT EXISTS commerce_orders_state_idx ON public.commerce_orders (orchestration_state);
CREATE UNIQUE INDEX IF NOT EXISTS commerce_orders_dispatch_key_idx
  ON public.commerce_orders (dispatch_idempotency_key)
  WHERE dispatch_idempotency_key IS NOT NULL;

GRANT SELECT ON public.commerce_orders TO authenticated;
GRANT ALL ON public.commerce_orders TO service_role;
ALTER TABLE public.commerce_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read commerce orders" ON public.commerce_orders
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER set_updated_at_commerce_orders BEFORE UPDATE ON public.commerce_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.commerce_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.commerce_orders(id) ON DELETE CASCADE,
  shopify_line_item_id text NOT NULL,
  shopify_variant_id text,
  shopify_product_id text,
  sku text,
  title text,
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric(12,2),
  zendrop_line_item_id text,
  zendrop_store_line_item_id text,
  zendrop_product_id text,
  zendrop_variant_id text,
  supplier_status text,
  tracking_number text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, shopify_line_item_id)
);
GRANT SELECT ON public.commerce_order_lines TO authenticated;
GRANT ALL ON public.commerce_order_lines TO service_role;
ALTER TABLE public.commerce_order_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read commerce order lines" ON public.commerce_order_lines
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER set_updated_at_commerce_order_lines BEFORE UPDATE ON public.commerce_order_lines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.commerce_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.commerce_orders(id) ON DELETE CASCADE,
  from_state text,
  to_state text NOT NULL,
  code text,
  message text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commerce_order_events_order_idx ON public.commerce_order_events (order_id, created_at DESC);
GRANT SELECT ON public.commerce_order_events TO authenticated;
GRANT ALL ON public.commerce_order_events TO service_role;
ALTER TABLE public.commerce_order_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read commerce order events" ON public.commerce_order_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.commerce_webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id text NOT NULL UNIQUE,
  topic text,
  shopify_order_id text,
  received_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.commerce_webhook_deliveries TO authenticated;
GRANT ALL ON public.commerce_webhook_deliveries TO service_role;
ALTER TABLE public.commerce_webhook_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read commerce webhook deliveries" ON public.commerce_webhook_deliveries
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.commerce_settings (
  id text PRIMARY KEY DEFAULT 'default',
  auto_fulfilment_enabled boolean NOT NULL DEFAULT false,
  allow_supplier_credit boolean NOT NULL DEFAULT false,
  safe_test_order_ids text[] NOT NULL DEFAULT '{}',
  max_orders_per_run integer NOT NULL DEFAULT 3,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.commerce_settings TO authenticated;
GRANT ALL ON public.commerce_settings TO service_role;
ALTER TABLE public.commerce_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read commerce settings" ON public.commerce_settings
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER set_updated_at_commerce_settings BEFORE UPDATE ON public.commerce_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
INSERT INTO public.commerce_settings (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

INSERT INTO public.automation_jobs (job_key, label, description, job_type, enabled, schedule_cron, config)
VALUES
  ('order_fulfilment_queue', 'Order fulfilment queue', 'Moves paid store orders through supplier fulfilment preview and confirmation.', 'sync', true, '11,41 * * * *', '{"batch_size": 3}'::jsonb),
  ('order_tracking_sync', 'Order tracking sync', 'Reads supplier fulfilment status and tracking, then updates the store so the customer is notified.', 'sync', true, '26,56 * * * *', '{"batch_size": 10}'::jsonb)
ON CONFLICT (job_key) DO NOTHING;