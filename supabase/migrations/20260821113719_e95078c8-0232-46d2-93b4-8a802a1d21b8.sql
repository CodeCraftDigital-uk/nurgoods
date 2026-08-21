CREATE TABLE IF NOT EXISTS public.pricing_formula_policy (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  formula_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.pricing_formula_policy TO authenticated;
GRANT ALL ON public.pricing_formula_policy TO service_role;

ALTER TABLE public.pricing_formula_policy ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Administrators read the pricing formula policy"
  ON public.pricing_formula_policy FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_pricing_formula_policy_updated_at
  BEFORE UPDATE ON public.pricing_formula_policy
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.pricing_formula_policy (id, formula_version)
VALUES (true, 'shopify-unitcost-markup-v4')
ON CONFLICT (id) DO NOTHING;

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
  LEFT JOIN public.product_classifications c
    ON c.product_id = p.id AND c.auto_published = true AND c.category_slug IS NOT NULL
  LEFT JOIN public.catalogue_categories cat
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
    -- Hard pricing publication gate. A listing is only public once every one
    -- of its variants has been priced on the approved formula and the store
    -- has been read back showing exactly that price.
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

CREATE OR REPLACE FUNCTION public.pricing_gate_stats()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH policy AS (
    SELECT formula_version FROM public.pricing_formula_policy WHERE id
  ),
  variant_state AS (
    SELECT
      v.product_id,
      CASE
        WHEN a.id IS NULL OR a.formula_version IS DISTINCT FROM (SELECT formula_version FROM policy)
          THEN 'pending'
        WHEN a.hold_reason IS NOT NULL OR a.push_state = 'held' THEN 'held'
        WHEN a.push_state = 'failed' THEN 'failed'
        WHEN a.push_state = 'drifted' THEN 'drift'
        WHEN a.push_state = 'in_sync'
          AND a.expected_price IS NOT NULL
          AND a.observed_shopify_price IS NOT NULL
          AND abs(a.observed_shopify_price - a.expected_price) < 0.005
          THEN 'verified'
        ELSE 'pending'
      END AS state
    FROM public.shopify_product_variants v
    LEFT JOIN public.product_price_authority a
      ON a.shopify_variant_id = v.shopify_variant_id
  )
  SELECT jsonb_build_object(
    'formula_version', (SELECT formula_version FROM policy),
    'variants_total', (SELECT count(*) FROM variant_state),
    'pending', (SELECT count(*) FROM variant_state WHERE state = 'pending'),
    'held', (SELECT count(*) FROM variant_state WHERE state = 'held'),
    'failed', (SELECT count(*) FROM variant_state WHERE state = 'failed'),
    'drift', (SELECT count(*) FROM variant_state WHERE state = 'drift'),
    'verified', (SELECT count(*) FROM variant_state WHERE state = 'verified'),
    'retry_due', (
      SELECT count(*) FROM public.product_price_authority
      WHERE next_attempt_at IS NOT NULL AND next_attempt_at <= now()
    ),
    'products_eligible', (
      SELECT count(DISTINCT product_id) FROM variant_state s1
      WHERE product_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM variant_state s2
          WHERE s2.product_id = s1.product_id AND s2.state <> 'verified'
        )
    ),
    'products_blocked', (
      SELECT count(DISTINCT product_id) FROM variant_state
      WHERE product_id IS NOT NULL AND state <> 'verified'
    ),
    'active_products_blocked', (
      SELECT count(*) FROM public.shopify_products p
      WHERE p.status = 'active'
        AND EXISTS (
          SELECT 1 FROM variant_state s
          WHERE s.product_id = p.id AND s.state <> 'verified'
        )
    ),
    'snapshot_products', (SELECT count(*) FROM public.storefront_snapshot),
    'last_error', (
      SELECT last_push_error FROM public.product_price_authority
      WHERE last_push_error IS NOT NULL
      ORDER BY updated_at DESC NULLS LAST LIMIT 1
    ),
    'measured_at', now()
  );
$function$;

GRANT EXECUTE ON FUNCTION public.pricing_gate_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.pricing_gate_stats() TO service_role;