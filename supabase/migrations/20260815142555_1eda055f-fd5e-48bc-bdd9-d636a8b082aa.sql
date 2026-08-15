-- Local editing layer for imported store legal documents
CREATE TABLE public.legal_source_overrides (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id uuid NOT NULL UNIQUE REFERENCES public.shopify_legal_sources(id) ON DELETE CASCADE,
  draft_title text NOT NULL DEFAULT '',
  draft_summary text,
  draft_body_html text NOT NULL DEFAULT '',
  published_title text,
  published_summary text,
  published_body_html text,
  published_at timestamp with time zone,
  upstream_fingerprint text,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.legal_source_overrides TO authenticated;
GRANT SELECT ON public.legal_source_overrides TO anon;
GRANT ALL ON public.legal_source_overrides TO service_role;

ALTER TABLE public.legal_source_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read published legal overrides"
ON public.legal_source_overrides FOR SELECT TO anon, authenticated
USING (published_body_html IS NOT NULL);

CREATE POLICY "Staff can read all legal overrides"
ON public.legal_source_overrides FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE POLICY "Staff can create legal overrides"
ON public.legal_source_overrides FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE POLICY "Staff can update legal overrides"
ON public.legal_source_overrides FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE POLICY "Staff can delete legal overrides"
ON public.legal_source_overrides FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE TRIGGER update_legal_source_overrides_updated_at
BEFORE UPDATE ON public.legal_source_overrides
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Audit trail of local legal edits
CREATE TABLE public.legal_override_revisions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id uuid NOT NULL REFERENCES public.shopify_legal_sources(id) ON DELETE CASCADE,
  action text NOT NULL,
  title text,
  summary text,
  body_html text,
  upstream_fingerprint text,
  actor uuid REFERENCES auth.users(id),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.legal_override_revisions TO authenticated;
GRANT ALL ON public.legal_override_revisions TO service_role;

ALTER TABLE public.legal_override_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read legal override revisions"
ON public.legal_override_revisions FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE INDEX legal_override_revisions_source_idx
ON public.legal_override_revisions (source_id, created_at DESC);

-- Customer contact enquiries
CREATE TABLE public.contact_enquiries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  category text NOT NULL,
  order_number text,
  subject text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'received',
  delivery_error text,
  email_attempted_at timestamp with time zone,
  ip_hash text,
  content_hash text,
  handled boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT contact_enquiries_status_check
    CHECK (status IN ('received', 'email_sent', 'email_failed', 'email_unconfigured', 'spam_rejected'))
);

GRANT SELECT, UPDATE ON public.contact_enquiries TO authenticated;
GRANT ALL ON public.contact_enquiries TO service_role;

ALTER TABLE public.contact_enquiries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read contact enquiries"
ON public.contact_enquiries FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE POLICY "Staff can update contact enquiries"
ON public.contact_enquiries FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'))
WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE TRIGGER update_contact_enquiries_updated_at
BEFORE UPDATE ON public.contact_enquiries
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX contact_enquiries_created_idx ON public.contact_enquiries (created_at DESC);
CREATE INDEX contact_enquiries_ip_hash_idx ON public.contact_enquiries (ip_hash, created_at DESC);
CREATE INDEX contact_enquiries_content_hash_idx ON public.contact_enquiries (content_hash, created_at DESC);