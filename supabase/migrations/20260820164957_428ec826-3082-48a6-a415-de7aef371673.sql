-- Variant level record of the price NUR GOODS itself calculated, and of what
-- the store is currently showing. The calculated price is the authority. A
-- supplier or store originated price is only ever recorded as an observation.
CREATE TABLE public.product_price_authority (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES public.shopify_products(id) ON DELETE CASCADE,
  shopify_product_id TEXT NOT NULL,
  shopify_variant_id TEXT NOT NULL UNIQUE,
  variant_title TEXT,
  currency TEXT NOT NULL DEFAULT 'GBP',

  -- Who decides the advertised price for this variant.
  authority_source TEXT NOT NULL DEFAULT 'nur_goods_calculated',
  formula_version TEXT NOT NULL,
  formula_inputs JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Evidence backing the calculation.
  landed_cost NUMERIC(12,2),
  landed_cost_verified_at TIMESTAMPTZ,
  cost_source TEXT,
  shipping_source TEXT,
  shipping_quoted_at TIMESTAMPTZ,

  -- The authoritative advertised price and what the store actually shows.
  expected_price NUMERIC(12,2),
  observed_shopify_price NUMERIC(12,2),
  observed_at TIMESTAMPTZ,
  drift_detected_at TIMESTAMPTZ,

  -- Outward push bookkeeping.
  push_state TEXT NOT NULL DEFAULT 'unverified',
  hold_reason TEXT,
  idempotency_key TEXT,
  last_pushed_at TIMESTAMPTZ,
  last_push_status TEXT,
  last_push_error TEXT,
  push_attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT product_price_authority_state_check CHECK (
    push_state IN ('unverified','held','in_sync','drifted','queued','failed')
  ),
  CONSTRAINT product_price_authority_authority_check CHECK (
    authority_source IN ('nur_goods_calculated','supplier_observed','store_observed')
  )
);

CREATE INDEX product_price_authority_state_idx
  ON public.product_price_authority (push_state, next_attempt_at);
CREATE INDEX product_price_authority_product_idx
  ON public.product_price_authority (product_id);

GRANT SELECT ON public.product_price_authority TO authenticated;
GRANT ALL ON public.product_price_authority TO service_role;

ALTER TABLE public.product_price_authority ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can review price authority"
ON public.product_price_authority
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'staff')
  OR public.has_role(auth.uid(), 'viewer')
);

CREATE TRIGGER product_price_authority_updated_at
BEFORE UPDATE ON public.product_price_authority
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();