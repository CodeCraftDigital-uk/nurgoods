ALTER TABLE public.shopify_product_variants ADD COLUMN IF NOT EXISTS barcode text;

CREATE TABLE public.product_identity_signals (
  product_id uuid PRIMARY KEY REFERENCES public.shopify_products(id) ON DELETE CASCADE,
  barcodes text[] NOT NULL DEFAULT '{}',
  skus text[] NOT NULL DEFAULT '{}',
  model_codes text[] NOT NULL DEFAULT '{}',
  vendor_key text,
  pack_quantity numeric,
  spec_signature text,
  variant_signature text,
  attribute_tokens text[] NOT NULL DEFAULT '{}',
  image_signatures text[] NOT NULL DEFAULT '{}',
  identity_fingerprint text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.product_identity_signals TO authenticated;
GRANT ALL ON public.product_identity_signals TO service_role;
ALTER TABLE public.product_identity_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read identity signals" ON public.product_identity_signals FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff') OR public.has_role(auth.uid(), 'viewer'));

CREATE TABLE public.duplicate_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_key text NOT NULL UNIQUE,
  confidence numeric NOT NULL DEFAULT 0,
  confidence_tier text NOT NULL DEFAULT 'low' CHECK (confidence_tier IN ('high','medium','low')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_product_id uuid REFERENCES public.shopify_products(id) ON DELETE SET NULL,
  canonical_handle text,
  member_count integer NOT NULL DEFAULT 0,
  suppressed_count integer NOT NULL DEFAULT 0,
  auto_suppressed boolean NOT NULL DEFAULT false,
  admin_decision text NOT NULL DEFAULT 'auto' CHECK (admin_decision IN ('auto','keep_separate','force_merge')),
  admin_note text,
  price_spread numeric,
  last_elected_at timestamptz,
  last_evaluated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.duplicate_groups TO anon;
GRANT SELECT ON public.duplicate_groups TO authenticated;
GRANT ALL ON public.duplicate_groups TO service_role;
ALTER TABLE public.duplicate_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read duplicate groups" ON public.duplicate_groups FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admins manage duplicate groups" ON public.duplicate_groups FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.duplicate_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.duplicate_groups(id) ON DELETE CASCADE,
  product_id uuid NOT NULL UNIQUE REFERENCES public.shopify_products(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'suspect' CHECK (role IN ('canonical','suppressed','suspect')),
  suppressed boolean NOT NULL DEFAULT false,
  match_score numeric,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  price numeric,
  available boolean,
  quality_score integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX duplicate_group_members_group_idx ON public.duplicate_group_members(group_id);
CREATE INDEX duplicate_group_members_suppressed_idx ON public.duplicate_group_members(suppressed) WHERE suppressed;
GRANT SELECT ON public.duplicate_group_members TO anon;
GRANT SELECT ON public.duplicate_group_members TO authenticated;
GRANT ALL ON public.duplicate_group_members TO service_role;
ALTER TABLE public.duplicate_group_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read duplicate members" ON public.duplicate_group_members FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admins manage duplicate members" ON public.duplicate_group_members FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.duplicate_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES public.duplicate_groups(id) ON DELETE CASCADE,
  product_id uuid,
  event_type text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX duplicate_audit_events_group_idx ON public.duplicate_audit_events(group_id, created_at DESC);
GRANT SELECT ON public.duplicate_audit_events TO authenticated;
GRANT ALL ON public.duplicate_audit_events TO service_role;
ALTER TABLE public.duplicate_audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read duplicate audit" ON public.duplicate_audit_events FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff') OR public.has_role(auth.uid(), 'viewer'));

CREATE TRIGGER product_identity_signals_updated_at BEFORE UPDATE ON public.product_identity_signals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER duplicate_groups_updated_at BEFORE UPDATE ON public.duplicate_groups FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER duplicate_group_members_updated_at BEFORE UPDATE ON public.duplicate_group_members FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.automation_jobs (job_key, label, description, job_type, enabled, schedule_cron, config)
VALUES
  ('catalogue_duplicate_identity', 'Product identity and de-duplication', 'Rebuilds product identity signals, groups genuinely identical listings and elects the canonical listing shown in the shop.', 'intelligence', true, '*/20 * * * *', '{}'::jsonb),
  ('catalogue_intelligence_worker', 'Catalogue intelligence worker', 'Drains the intelligence queue in bounded batches so classification, search intelligence and de-duplication complete without manual action.', 'intelligence', true, '*/10 * * * *', '{}'::jsonb)
ON CONFLICT (job_key) DO NOTHING;