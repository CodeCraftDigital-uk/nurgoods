-- Supplier cost of goods mirrored from the store, so pricing never guesses.
ALTER TABLE public.shopify_product_variants
  ADD COLUMN IF NOT EXISTS unit_cost numeric,
  ADD COLUMN IF NOT EXISTS unit_cost_currency text,
  ADD COLUMN IF NOT EXISTS cost_source text,
  ADD COLUMN IF NOT EXISTS cost_synced_at timestamptz;

-- Intelligent sourcing scoring on candidates.
ALTER TABLE public.zendrop_import_candidates
  ADD COLUMN IF NOT EXISTS suitability_score integer,
  ADD COLUMN IF NOT EXISTS score_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS screening jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Intelligent sourcing policy controls.
ALTER TABLE public.zendrop_sourcing_rules
  ADD COLUMN IF NOT EXISTS min_retail_price numeric,
  ADD COLUMN IF NOT EXISTS min_suitability_score integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS restricted_keywords text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS max_variant_count integer,
  ADD COLUMN IF NOT EXISTS continuous_sourcing boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS target_catalogue_size integer;

-- Raise the ceiling so batch presets up to 500 are storable.
UPDATE public.zendrop_sourcing_rules SET batch_size = batch_size WHERE id = 'default';

CREATE TABLE IF NOT EXISTS public.pricing_audit_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL DEFAULT 'preview',
  status text NOT NULL DEFAULT 'running',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  message text,
  created_by uuid REFERENCES auth.users(id),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pricing_audit_runs TO authenticated;
GRANT ALL ON public.pricing_audit_runs TO service_role;
ALTER TABLE public.pricing_audit_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage pricing audit runs" ON public.pricing_audit_runs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.pricing_audit_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.pricing_audit_runs(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.shopify_products(id) ON DELETE CASCADE,
  shopify_product_id text NOT NULL,
  handle text,
  product_title text,
  shopify_variant_id text NOT NULL,
  variant_title text,
  currency text NOT NULL DEFAULT 'GBP',
  current_price numeric,
  unit_cost numeric,
  cost_source text,
  shipping_cost numeric,
  shipping_source text,
  landed_cost numeric,
  calculated_price numeric,
  current_margin numeric,
  proposed_margin numeric,
  status text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pricing_audit_items_run_idx ON public.pricing_audit_items(run_id);
CREATE INDEX IF NOT EXISTS pricing_audit_items_status_idx ON public.pricing_audit_items(run_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pricing_audit_items TO authenticated;
GRANT ALL ON public.pricing_audit_items TO service_role;
ALTER TABLE public.pricing_audit_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage pricing audit items" ON public.pricing_audit_items
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.product_price_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES public.pricing_audit_runs(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.shopify_products(id) ON DELETE SET NULL,
  shopify_product_id text NOT NULL,
  shopify_variant_id text NOT NULL,
  variant_title text,
  old_price numeric,
  new_price numeric NOT NULL,
  unit_cost numeric,
  shipping_cost numeric,
  landed_cost numeric,
  target_margin numeric,
  rounding_mode text,
  cost_source text,
  shipping_source text,
  source text NOT NULL DEFAULT 'admin_reprice',
  applied_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_price_revisions_variant_idx
  ON public.product_price_revisions(shopify_variant_id, created_at DESC);

GRANT SELECT, INSERT ON public.product_price_revisions TO authenticated;
GRANT ALL ON public.product_price_revisions TO service_role;
ALTER TABLE public.product_price_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read price revisions" ON public.product_price_revisions
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins write price revisions" ON public.product_price_revisions
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_pricing_audit_runs_updated_at
  BEFORE UPDATE ON public.pricing_audit_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();