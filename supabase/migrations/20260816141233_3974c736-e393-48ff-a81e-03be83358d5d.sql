CREATE TABLE public.product_intake_records (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  shopify_product_id text NOT NULL UNIQUE,
  product_id uuid REFERENCES public.shopify_products(id) ON DELETE SET NULL,
  title text,
  handle text,
  source text NOT NULL DEFAULT 'webhook',
  state text NOT NULL DEFAULT 'detected',
  previous_state text,
  reason_code text,
  reason text,
  version_fingerprint text,
  processed_fingerprint text,
  attempts integer NOT NULL DEFAULT 0,
  validation jsonb NOT NULL DEFAULT '{}'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  locked_at timestamptz,
  lock_token text,
  detected_at timestamptz NOT NULL DEFAULT now(),
  validated_at timestamptz,
  identity_at timestamptz,
  classified_at timestamptz,
  seo_at timestamptz,
  approved_at timestamptz,
  published_at timestamptz,
  quarantined_at timestamptz,
  rejected_at timestamptz,
  failed_at timestamptz,
  last_transition_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_intake_state_check CHECK (state IN (
    'detected','validating','quarantined','duplicate_check','classification',
    'seo','approved','published_to_storefront','rejected','failed'
  )),
  CONSTRAINT product_intake_source_check CHECK (source IN ('webhook','delta_sync','backfill','manual'))
);

CREATE INDEX product_intake_records_state_idx ON public.product_intake_records (state, last_transition_at DESC);
CREATE INDEX product_intake_records_product_idx ON public.product_intake_records (product_id);

GRANT SELECT ON public.product_intake_records TO authenticated;
GRANT ALL ON public.product_intake_records TO service_role;
ALTER TABLE public.product_intake_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read intake records" ON public.product_intake_records
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.product_intake_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  intake_id uuid NOT NULL REFERENCES public.product_intake_records(id) ON DELETE CASCADE,
  shopify_product_id text,
  from_state text,
  to_state text NOT NULL,
  reason_code text,
  message text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX product_intake_events_intake_idx ON public.product_intake_events (intake_id, created_at DESC);

GRANT SELECT ON public.product_intake_events TO authenticated;
GRANT ALL ON public.product_intake_events TO service_role;
ALTER TABLE public.product_intake_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read intake history" ON public.product_intake_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.product_intake_policy (
  id text NOT NULL DEFAULT 'default' PRIMARY KEY,
  automatic_processing boolean NOT NULL DEFAULT true,
  automatic_storefront_exposure boolean NOT NULL DEFAULT true,
  require_image boolean NOT NULL DEFAULT true,
  require_purchasable_variant boolean NOT NULL DEFAULT true,
  require_valid_price boolean NOT NULL DEFAULT true,
  require_description boolean NOT NULL DEFAULT true,
  duplicate_protection boolean NOT NULL DEFAULT true,
  catalogue_classification boolean NOT NULL DEFAULT true,
  seo_intelligence boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_intake_policy_single CHECK (id = 'default')
);

GRANT SELECT ON public.product_intake_policy TO authenticated;
GRANT ALL ON public.product_intake_policy TO service_role;
ALTER TABLE public.product_intake_policy ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read intake policy" ON public.product_intake_policy
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update intake policy" ON public.product_intake_policy
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.product_intake_policy (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

CREATE TRIGGER update_product_intake_records_updated_at
  BEFORE UPDATE ON public.product_intake_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_product_intake_policy_updated_at
  BEFORE UPDATE ON public.product_intake_policy
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Everything already in the catalogue is recorded as current and published so
-- the rollout cannot hide or reprocess live listings.
INSERT INTO public.product_intake_records (
  shopify_product_id, product_id, title, handle, source, state, reason_code, reason,
  version_fingerprint, processed_fingerprint,
  detected_at, validated_at, identity_at, classified_at, seo_at, approved_at, published_at, last_transition_at
)
SELECT
  p.shopify_product_id, p.id, p.title, p.handle, 'backfill', 'published_to_storefront',
  'existing_catalogue', 'Already live before automated intake began',
  p.shopify_product_id || '@' || COALESCE(p.shopify_updated_at::text, ''),
  p.shopify_product_id || '@' || COALESCE(p.shopify_updated_at::text, ''),
  COALESCE(p.created_at, now()), COALESCE(p.created_at, now()), COALESCE(p.created_at, now()),
  COALESCE(p.created_at, now()), COALESCE(p.created_at, now()), COALESCE(p.created_at, now()),
  COALESCE(p.created_at, now()), now()
FROM public.shopify_products p
ON CONFLICT (shopify_product_id) DO NOTHING;

INSERT INTO public.automation_jobs (job_key, label, description, job_type, enabled, schedule_cron, requires_integration, config)
VALUES
  ('product_intake_delta_sync', 'Product intake delta sync',
   'Low frequency safety net that looks for Shopify products the intake webhook may have missed.',
   'intake', true, '0 */6 * * *', 'shopify', '{}'::jsonb),
  ('product_intake_worker', 'Product intake worker',
   'Moves newly detected products through validation, identity, classification and search intelligence.',
   'intake', true, '*/15 * * * *', null, '{}'::jsonb)
ON CONFLICT (job_key) DO NOTHING;