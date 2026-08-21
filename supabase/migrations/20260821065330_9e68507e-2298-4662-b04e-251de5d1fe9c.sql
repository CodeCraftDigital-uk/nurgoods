CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION public.refresh_storefront_snapshot()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  rebuilt integer := 0;
BEGIN
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
    AND NOT EXISTS (
      SELECT 1 FROM public.duplicate_group_members m
      WHERE m.product_id = p.id AND m.suppressed = true
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.product_intake_records r
      WHERE r.product_id = p.id AND r.state <> 'published_to_storefront'
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

CREATE INDEX IF NOT EXISTS storefront_snapshot_search_trgm
  ON public.storefront_snapshot USING gin (search_text gin_trgm_ops);

CREATE INDEX IF NOT EXISTS storefront_snapshot_search_fts
  ON public.storefront_snapshot USING gin (to_tsvector('simple', coalesce(search_text, '')));