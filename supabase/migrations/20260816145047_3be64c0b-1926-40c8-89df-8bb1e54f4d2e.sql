-- Pricing policy (singleton)
CREATE TABLE public.zendrop_pricing_settings (
  id text PRIMARY KEY DEFAULT 'default',
  pricing_mode text NOT NULL DEFAULT 'target_gross_margin',
  target_margin numeric NOT NULL DEFAULT 0.60,
  rounding_mode text NOT NULL DEFAULT 'charm_99',
  min_promo_margin numeric NOT NULL DEFAULT 0.35,
  promo_discount numeric NOT NULL DEFAULT 0.20,
  shipping_market text NOT NULL DEFAULT 'GB',
  currency text NOT NULL DEFAULT 'GBP',
  allow_incomplete_pricing boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.zendrop_pricing_settings TO authenticated;
GRANT ALL ON public.zendrop_pricing_settings TO service_role;
ALTER TABLE public.zendrop_pricing_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage supplier pricing settings"
  ON public.zendrop_pricing_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Sourcing rules (singleton)
CREATE TABLE public.zendrop_sourcing_rules (
  id text PRIMARY KEY DEFAULT 'default',
  enabled boolean NOT NULL DEFAULT false,
  allowed_categories text[] NOT NULL DEFAULT '{}',
  blocked_categories text[] NOT NULL DEFAULT '{}',
  require_stock boolean NOT NULL DEFAULT true,
  require_image boolean NOT NULL DEFAULT true,
  require_uk_shipping boolean NOT NULL DEFAULT true,
  duplicate_precheck boolean NOT NULL DEFAULT true,
  min_landed_cost numeric,
  max_landed_cost numeric,
  max_retail_price numeric,
  daily_import_cap integer NOT NULL DEFAULT 25,
  batch_size integer NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.zendrop_sourcing_rules TO authenticated;
GRANT ALL ON public.zendrop_sourcing_rules TO service_role;
ALTER TABLE public.zendrop_sourcing_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage supplier sourcing rules"
  ON public.zendrop_sourcing_rules FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Discovered supplier capabilities
CREATE TABLE public.zendrop_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_name text NOT NULL UNIQUE,
  kind text NOT NULL DEFAULT 'unknown',
  available boolean NOT NULL DEFAULT false,
  description text,
  input_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.zendrop_capabilities TO authenticated;
GRANT ALL ON public.zendrop_capabilities TO service_role;
ALTER TABLE public.zendrop_capabilities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read supplier capabilities"
  ON public.zendrop_capabilities FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Import candidates state machine
CREATE TABLE public.zendrop_import_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  zendrop_product_id text NOT NULL,
  zendrop_variant_ids text[] NOT NULL DEFAULT '{}',
  title text NOT NULL,
  image_url text,
  category text,
  state text NOT NULL DEFAULT 'candidate',
  previous_state text,
  hold_reason text,
  failure_reason text,
  attempts integer NOT NULL DEFAULT 0,
  is_test boolean NOT NULL DEFAULT false,
  currency text NOT NULL DEFAULT 'GBP',
  supplier_cost numeric,
  shipping_cost numeric,
  landed_cost numeric,
  calculated_price numeric,
  suggested_retail numeric,
  gross_margin numeric,
  pricing_complete boolean NOT NULL DEFAULT false,
  pricing_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  supplier_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  write_response jsonb NOT NULL DEFAULT '{}'::jsonb,
  store_reference text,
  shopify_product_id text,
  product_id uuid REFERENCES public.shopify_products(id) ON DELETE SET NULL,
  locked_at timestamptz,
  lock_token text,
  queued_at timestamptz,
  imported_at timestamptz,
  linked_at timestamptz,
  live_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX zendrop_import_candidates_state_idx ON public.zendrop_import_candidates (state, created_at DESC);
CREATE INDEX zendrop_import_candidates_product_idx ON public.zendrop_import_candidates (zendrop_product_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.zendrop_import_candidates TO authenticated;
GRANT ALL ON public.zendrop_import_candidates TO service_role;
ALTER TABLE public.zendrop_import_candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage supplier import candidates"
  ON public.zendrop_import_candidates FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Audit trail
CREATE TABLE public.zendrop_import_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid REFERENCES public.zendrop_import_candidates(id) ON DELETE CASCADE,
  zendrop_product_id text,
  from_state text,
  to_state text NOT NULL,
  reason_code text,
  message text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX zendrop_import_events_candidate_idx ON public.zendrop_import_events (candidate_id, created_at DESC);
GRANT SELECT ON public.zendrop_import_events TO authenticated;
GRANT ALL ON public.zendrop_import_events TO service_role;
ALTER TABLE public.zendrop_import_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read supplier import events"
  ON public.zendrop_import_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Timestamps
CREATE TRIGGER update_zendrop_pricing_settings_updated_at BEFORE UPDATE ON public.zendrop_pricing_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_zendrop_sourcing_rules_updated_at BEFORE UPDATE ON public.zendrop_sourcing_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_zendrop_capabilities_updated_at BEFORE UPDATE ON public.zendrop_capabilities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_zendrop_import_candidates_updated_at BEFORE UPDATE ON public.zendrop_import_candidates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Defaults
INSERT INTO public.zendrop_pricing_settings (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.zendrop_sourcing_rules (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.integrations (provider, label, status)
  VALUES ('zendrop', 'Zendrop', 'not_connected')
  ON CONFLICT (provider) DO NOTHING;