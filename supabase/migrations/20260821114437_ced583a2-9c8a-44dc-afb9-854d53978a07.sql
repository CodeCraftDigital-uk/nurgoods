CREATE TABLE IF NOT EXISTS public.product_pricing_lifecycle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopify_product_id text NOT NULL UNIQUE,
  product_id uuid,
  status text NOT NULL DEFAULT 'pending',
  formula_version text,
  verified_at timestamptz,
  input_hash text,
  last_app_write_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  reason text,
  activation_result text,
  publication_result text,
  variants_total integer NOT NULL DEFAULT 0,
  variants_verified integer NOT NULL DEFAULT 0,
  last_priced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_pricing_lifecycle_status_check
    CHECK (status IN ('pending', 'processing', 'verified', 'held', 'error'))
);

GRANT SELECT ON public.product_pricing_lifecycle TO authenticated;
GRANT ALL ON public.product_pricing_lifecycle TO service_role;

ALTER TABLE public.product_pricing_lifecycle ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Administrators read the pricing lifecycle"
  ON public.product_pricing_lifecycle FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS product_pricing_lifecycle_status_idx
  ON public.product_pricing_lifecycle (status);
CREATE INDEX IF NOT EXISTS product_pricing_lifecycle_product_idx
  ON public.product_pricing_lifecycle (product_id);
CREATE INDEX IF NOT EXISTS product_pricing_lifecycle_retry_idx
  ON public.product_pricing_lifecycle (next_attempt_at);

CREATE TRIGGER update_product_pricing_lifecycle_updated_at
  BEFORE UPDATE ON public.product_pricing_lifecycle
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.refresh_storefront_snapshot()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rebuilt integer := 0;
  approved_formula text;
BEGIN
  SELECT formula_version INTO approved_formula FROM public.pricing_formula_policy WHERE id;

  CREATE TEMP TABLE _sf_new ON COMMIT DROP AS
  SELECT
    p.id AS product_id,
    p.handle,
    p.title,
    p.product_type,
    p.vendor,
    COALESCE(p.tags, '{}') AS tags,
    cat.slug AS category_slug,
    cat.name AS category_name,
    p.featured_image_url AS image_url,
    p.price_min,
    p.price_max,
    p.currency,
    p.compare_at_price_min,
    p.available_for_sale,
    p.variant_count,
    NULLIF(btrim(COALESCE(e.summary, '')), '') AS summary,
    p.seo_title,
    p.seo_description,
    COALESCE(col.handles, '{}') AS collection_handles,
    lower(
      concat_ws(' ',
        p.title,
        p.product_type,
        p.vendor,
        array_to_string(COALESCE(p.tags, '{}'), ' '),
        cat.name,
        replace(COALESCE(cat.slug, ''), '-', ' '),
        replace(COALESCE(p.handle, ''), '-', ' '),
        e.summary,
        p.seo_title,
        p.seo_description,
        left(COALESCE(p.description, ''), 6000),
        col.searchable,
        var.searchable
      )
    ) AS search_text,
    COALESCE(p.shopify_updated_at, p.last_synced_at) AS updated_at
  FROM public.shopify_products p
  JOIN public.product_classifications c
    ON c.product_id = p.id AND c.auto_published = true AND c.category_slug IS NOT NULL
  JOIN public.catalogue_categories cat
    ON cat.slug = c.category_slug AND cat.enabled = true
  LEFT JOIN public.product_enrichment e ON e.product_id = p.id
  LEFT JOIN LATERAL (
    SELECT
      array_agg(DISTINCT sc.handle) AS handles,
      string_agg(DISTINCT concat_ws(' ', sc.title, replace(sc.handle, '-', ' ')), ' ') AS searchable
    FROM public.shopify_product_collections pc
    JOIN public.shopify_collections sc ON sc.id = pc.collection_id
    WHERE pc.product_id = p.id
  ) col ON true
  LEFT JOIN LATERAL (
    SELECT string_agg(
      DISTINCT concat_ws(' ', v.title, v.sku, COALESCE(v.selected_options::text, '')),
      ' '
    ) AS searchable
    FROM public.shopify_product_variants v
    WHERE v.product_id = p.id
  ) var ON true
  WHERE p.status = 'active'
    AND p.handle IS NOT NULL
    AND NULLIF(btrim(COALESCE(p.title, '')), '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.duplicate_group_members m
      WHERE m.product_id = p.id AND m.suppressed = true
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.product_intake_records r
      WHERE r.product_id = p.id
        AND r.state IN ('quarantined', 'rejected', 'failed')
    )
    -- Explicit pricing lifecycle gate. Only the pricing service may mark a
    -- product verified, and only after every variant price was written to the
    -- store and read back identical on the approved formula.
    AND EXISTS (
      SELECT 1 FROM public.product_pricing_lifecycle l
      WHERE l.shopify_product_id = p.shopify_product_id
        AND l.status = 'verified'
        AND l.formula_version = approved_formula
    )
    -- Variant level belt and braces on the same evidence.
    AND EXISTS (
      SELECT 1 FROM public.shopify_product_variants v WHERE v.product_id = p.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.shopify_product_variants v
      LEFT JOIN public.product_price_authority a
        ON a.shopify_variant_id = v.shopify_variant_id
      WHERE v.product_id = p.id
        AND (
          a.id IS NULL
          OR a.formula_version IS DISTINCT FROM approved_formula
          OR a.push_state <> 'in_sync'
          OR a.hold_reason IS NOT NULL
          OR a.expected_price IS NULL
          OR a.observed_shopify_price IS NULL
          OR abs(a.observed_shopify_price - a.expected_price) >= 0.005
        )
    );

  DELETE FROM public.storefront_snapshot s
  WHERE NOT EXISTS (SELECT 1 FROM _sf_new n WHERE n.product_id = s.product_id);

  INSERT INTO public.storefront_snapshot AS s (
    product_id, handle, title, product_type, vendor, tags, category_slug, category_name,
    image_url, price_min, price_max, currency, compare_at_price_min, available_for_sale,
    variant_count, summary, seo_title, seo_description, collection_handles, search_text,
    updated_at, refreshed_at
  )
  SELECT
    n.product_id, n.handle, n.title, n.product_type, n.vendor, n.tags, n.category_slug, n.category_name,
    n.image_url, n.price_min, n.price_max, n.currency, n.compare_at_price_min, n.available_for_sale,
    n.variant_count, n.summary, n.seo_title, n.seo_description, n.collection_handles, n.search_text,
    n.updated_at, now()
  FROM _sf_new n
  ON CONFLICT (product_id) DO UPDATE SET
    handle = EXCLUDED.handle,
    title = EXCLUDED.title,
    product_type = EXCLUDED.product_type,
    vendor = EXCLUDED.vendor,
    tags = EXCLUDED.tags,
    category_slug = EXCLUDED.category_slug,
    category_name = EXCLUDED.category_name,
    image_url = EXCLUDED.image_url,
    price_min = EXCLUDED.price_min,
    price_max = EXCLUDED.price_max,
    currency = EXCLUDED.currency,
    compare_at_price_min = EXCLUDED.compare_at_price_min,
    available_for_sale = EXCLUDED.available_for_sale,
    variant_count = EXCLUDED.variant_count,
    summary = EXCLUDED.summary,
    seo_title = EXCLUDED.seo_title,
    seo_description = EXCLUDED.seo_description,
    collection_handles = EXCLUDED.collection_handles,
    search_text = EXCLUDED.search_text,
    updated_at = EXCLUDED.updated_at,
    refreshed_at = now();

  SELECT count(*) INTO rebuilt FROM public.storefront_snapshot;

  INSERT INTO public.storefront_snapshot_meta (id, refreshed_at, product_count, version)
  VALUES (true, now(), rebuilt, 1)
  ON CONFLICT (id) DO UPDATE SET
    refreshed_at = now(),
    product_count = EXCLUDED.product_count,
    version = public.storefront_snapshot_meta.version + 1;

  RETURN rebuilt;
END;
$function$;

CREATE OR REPLACE FUNCTION public.pricing_lifecycle_stats()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'formula_version', (SELECT formula_version FROM public.pricing_formula_policy WHERE id),
    'pending', (SELECT count(*) FROM public.product_pricing_lifecycle WHERE status = 'pending'),
    'processing', (SELECT count(*) FROM public.product_pricing_lifecycle WHERE status = 'processing'),
    'verified', (SELECT count(*) FROM public.product_pricing_lifecycle WHERE status = 'verified'),
    'held', (SELECT count(*) FROM public.product_pricing_lifecycle WHERE status = 'held'),
    'error', (SELECT count(*) FROM public.product_pricing_lifecycle WHERE status = 'error'),
    'tracked', (SELECT count(*) FROM public.product_pricing_lifecycle),
    'untracked_products', (
      SELECT count(*) FROM public.shopify_products p
      WHERE NOT EXISTS (
        SELECT 1 FROM public.product_pricing_lifecycle l
        WHERE l.shopify_product_id = p.shopify_product_id
      )
    ),
    'stale_formula', (
      SELECT count(*) FROM public.product_pricing_lifecycle
      WHERE formula_version IS DISTINCT FROM
        (SELECT formula_version FROM public.pricing_formula_policy WHERE id)
    ),
    'retry_due', (
      SELECT count(*) FROM public.product_pricing_lifecycle
      WHERE next_attempt_at IS NOT NULL AND next_attempt_at <= now()
    ),
    'last_priced_at', (SELECT max(last_priced_at) FROM public.product_pricing_lifecycle),
    'last_verified_at', (SELECT max(verified_at) FROM public.product_pricing_lifecycle),
    'recent_reasons', (
      SELECT COALESCE(jsonb_agg(r), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'shopify_product_id', shopify_product_id,
          'status', status,
          'reason', reason,
          'attempts', attempts,
          'next_attempt_at', next_attempt_at,
          'activation_result', activation_result,
          'publication_result', publication_result
        ) AS r
        FROM public.product_pricing_lifecycle
        WHERE status IN ('held', 'error', 'pending', 'processing')
        ORDER BY updated_at DESC
        LIMIT 20
      ) t
    ),
    'measured_at', now()
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.pricing_lifecycle_stats() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pricing_lifecycle_stats() FROM anon;
REVOKE EXECUTE ON FUNCTION public.pricing_lifecycle_stats() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.pricing_lifecycle_stats() TO service_role;