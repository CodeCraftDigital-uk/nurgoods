CREATE TABLE public.shopify_legal_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL CHECK (source_type IN ('shop_policy','shopify_page')),
  shopify_id text NOT NULL UNIQUE,
  policy_type text,
  title text NOT NULL,
  handle text,
  slug text NOT NULL,
  body_html text NOT NULL DEFAULT '',
  body_summary text,
  source_url text,
  is_published boolean NOT NULL DEFAULT false,
  shopify_created_at timestamptz,
  shopify_updated_at timestamptz,
  shopify_published_at timestamptz,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  sync_status text NOT NULL DEFAULT 'synced' CHECK (sync_status IN ('synced','error')),
  sync_error text,
  has_liquid boolean NOT NULL DEFAULT false,
  liquid_tokens text[] NOT NULL DEFAULT '{}',
  has_placeholders boolean NOT NULL DEFAULT false,
  placeholder_tokens text[] NOT NULL DEFAULT '{}',
  review_status text NOT NULL DEFAULT 'current' CHECK (review_status IN ('current','needs_review','unpublished','sync_error')),
  public_visible boolean NOT NULL DEFAULT false,
  exclude_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX shopify_legal_sources_slug_key ON public.shopify_legal_sources (slug);

GRANT SELECT ON public.shopify_legal_sources TO anon;
GRANT SELECT ON public.shopify_legal_sources TO authenticated;
GRANT ALL ON public.shopify_legal_sources TO service_role;

ALTER TABLE public.shopify_legal_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read every imported legal source"
ON public.shopify_legal_sources FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Public can read publishable legal sources"
ON public.shopify_legal_sources FOR SELECT TO anon
USING (public_visible = true AND is_published = true);

CREATE TRIGGER update_shopify_legal_sources_updated_at
BEFORE UPDATE ON public.shopify_legal_sources
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();