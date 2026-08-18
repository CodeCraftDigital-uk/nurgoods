ALTER TABLE public.zendrop_pricing_settings
  ADD COLUMN IF NOT EXISTS supported_markets text[] NOT NULL DEFAULT ARRAY['GB','US']::text[],
  ADD COLUMN IF NOT EXISTS free_shipping_markets text[] NOT NULL DEFAULT ARRAY['GB','US']::text[];

CREATE TABLE IF NOT EXISTS public.product_market_eligibility (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_product_id text NOT NULL,
  shopify_product_id text,
  product_id uuid,
  market text NOT NULL,
  shipping_amount numeric,
  shipping_currency text,
  shipping_service text,
  quoted_at timestamptz,
  status text NOT NULL DEFAULT 'missing',
  eligible boolean NOT NULL DEFAULT false,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier_product_id, market)
);

CREATE INDEX IF NOT EXISTS product_market_eligibility_market_idx
  ON public.product_market_eligibility (market, eligible);
CREATE INDEX IF NOT EXISTS product_market_eligibility_shopify_idx
  ON public.product_market_eligibility (shopify_product_id);

GRANT SELECT ON public.product_market_eligibility TO authenticated;
GRANT ALL ON public.product_market_eligibility TO service_role;

ALTER TABLE public.product_market_eligibility ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Signed in staff can read market eligibility"
  ON public.product_market_eligibility
  FOR SELECT
  TO authenticated
  USING (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS update_product_market_eligibility_updated_at ON public.product_market_eligibility;
CREATE TRIGGER update_product_market_eligibility_updated_at
  BEFORE UPDATE ON public.product_market_eligibility
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();