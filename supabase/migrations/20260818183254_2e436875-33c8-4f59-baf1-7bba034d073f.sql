CREATE TABLE public.publication_audit_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL DEFAULT 'dry_run',
  status text NOT NULL DEFAULT 'running',
  products_inspected integer NOT NULL DEFAULT 0,
  products_drifted integer NOT NULL DEFAULT 0,
  products_changed integer NOT NULL DEFAULT 0,
  desired_channels text[] NOT NULL DEFAULT ARRAY['Nur Goods Headless Store']::text[],
  note text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.publication_audit_runs TO authenticated;
GRANT ALL ON public.publication_audit_runs TO service_role;
ALTER TABLE public.publication_audit_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage publication audit runs" ON public.publication_audit_runs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.publication_audit_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.publication_audit_runs(id) ON DELETE CASCADE,
  shopify_product_id text NOT NULL,
  product_title text,
  product_status text,
  current_channels text[] NOT NULL DEFAULT ARRAY[]::text[],
  desired_channels text[] NOT NULL DEFAULT ARRAY[]::text[],
  to_publish text[] NOT NULL DEFAULT ARRAY[]::text[],
  to_unpublish text[] NOT NULL DEFAULT ARRAY[]::text[],
  drifted boolean NOT NULL DEFAULT false,
  changed boolean NOT NULL DEFAULT false,
  message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX publication_audit_items_run_idx ON public.publication_audit_items (run_id);
CREATE UNIQUE INDEX publication_audit_items_run_product_idx ON public.publication_audit_items (run_id, shopify_product_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.publication_audit_items TO authenticated;
GRANT ALL ON public.publication_audit_items TO service_role;
ALTER TABLE public.publication_audit_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage publication audit items" ON public.publication_audit_items
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_publication_audit_runs_updated_at
  BEFORE UPDATE ON public.publication_audit_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_publication_audit_items_updated_at
  BEFORE UPDATE ON public.publication_audit_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();