CREATE TABLE public.product_supplier_links (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id uuid REFERENCES public.shopify_products(id) ON DELETE CASCADE,
  shopify_product_id text NOT NULL UNIQUE,
  supplier text NOT NULL DEFAULT 'zendrop',
  supplier_product_id text NOT NULL,
  supplier_import_list_id text,
  shipping_cost numeric,
  shipping_currency text NOT NULL DEFAULT 'GBP',
  shipping_source text,
  quoted_amount numeric,
  quoted_currency text,
  fx_rate numeric,
  fx_as_of text,
  match_method text NOT NULL,
  match_confidence text NOT NULL DEFAULT 'high',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  variant_map jsonb NOT NULL DEFAULT '[]'::jsonb,
  verified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX product_supplier_links_product_idx ON public.product_supplier_links(product_id);

GRANT SELECT ON public.product_supplier_links TO authenticated;
GRANT ALL ON public.product_supplier_links TO service_role;

ALTER TABLE public.product_supplier_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read supplier links"
ON public.product_supplier_links FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

CREATE TRIGGER set_updated_at_product_supplier_links
BEFORE UPDATE ON public.product_supplier_links
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();