CREATE TABLE IF NOT EXISTS public.storefront_snapshot (
  product_id uuid PRIMARY KEY,
  handle text NOT NULL,
  title text NOT NULL,
  product_type text,
  vendor text,
  tags text[] NOT NULL DEFAULT '{}',
  category_slug text,
  category_name text,
  image_url text,
  price_min numeric,
  price_max numeric,
  currency text,
  compare_at_price_min numeric,
  available_for_sale boolean,
  variant_count integer NOT NULL DEFAULT 0,
  summary text,
  seo_title text,
  seo_description text,
  collection_handles text[] NOT NULL DEFAULT '{}',
  search_text text,
  updated_at timestamptz,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS storefront_snapshot_handle_idx ON public.storefront_snapshot (handle);
CREATE INDEX IF NOT EXISTS storefront_snapshot_title_idx ON public.storefront_snapshot (title);
CREATE INDEX IF NOT EXISTS storefront_snapshot_category_idx ON public.storefront_snapshot (category_slug);
CREATE INDEX IF NOT EXISTS storefront_snapshot_price_min_idx ON public.storefront_snapshot (price_min);
CREATE INDEX IF NOT EXISTS storefront_snapshot_price_max_idx ON public.storefront_snapshot (price_max);
CREATE INDEX IF NOT EXISTS storefront_snapshot_updated_idx ON public.storefront_snapshot (updated_at DESC);
CREATE INDEX IF NOT EXISTS storefront_snapshot_tags_idx ON public.storefront_snapshot USING gin (tags);
CREATE INDEX IF NOT EXISTS storefront_snapshot_collections_idx ON public.storefront_snapshot USING gin (collection_handles);
CREATE INDEX IF NOT EXISTS storefront_snapshot_type_idx ON public.storefront_snapshot (product_type);

GRANT SELECT ON public.storefront_snapshot TO anon;
GRANT SELECT ON public.storefront_snapshot TO authenticated;
GRANT ALL ON public.storefront_snapshot TO service_role;
ALTER TABLE public.storefront_snapshot ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Storefront snapshot is public" ON public.storefront_snapshot;
CREATE POLICY "Storefront snapshot is public" ON public.storefront_snapshot FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS public.storefront_snapshot_meta (
  id boolean PRIMARY KEY DEFAULT true,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  product_count integer NOT NULL DEFAULT 0,
  version bigint NOT NULL DEFAULT 1,
  CONSTRAINT storefront_snapshot_meta_single CHECK (id)
);

GRANT SELECT ON public.storefront_snapshot_meta TO anon;
GRANT SELECT ON public.storefront_snapshot_meta TO authenticated;
GRANT ALL ON public.storefront_snapshot_meta TO service_role;
ALTER TABLE public.storefront_snapshot_meta ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Storefront snapshot meta is public" ON public.storefront_snapshot_meta;
CREATE POLICY "Storefront snapshot meta is public" ON public.storefront_snapshot_meta FOR SELECT USING (true);

CREATE OR REPLACE FUNCTION public.refresh_storefront_snapshot()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      concat_ws(' ', p.title, p.product_type, p.vendor, array_to_string(COALESCE(p.tags, '{}'), ' '))
    ) AS search_text,
    COALESCE(p.shopify_updated_at, p.last_synced_at) AS updated_at
  FROM public.shopify_products p
  LEFT JOIN public.product_classifications c
    ON c.product_id = p.id AND c.auto_published = true AND c.category_slug IS NOT NULL
  LEFT JOIN public.catalogue_categories cat
    ON cat.slug = c.category_slug AND cat.enabled = true
  LEFT JOIN public.product_enrichment e ON e.product_id = p.id
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT sc.handle) AS handles
    FROM public.shopify_product_collections pc
    JOIN public.shopify_collections sc ON sc.id = pc.collection_id
    WHERE pc.product_id = p.id
  ) col ON true
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
$$;

REVOKE ALL ON FUNCTION public.refresh_storefront_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_storefront_snapshot() TO service_role;

CREATE OR REPLACE FUNCTION public.recover_stale_automation_runs(_budget_minutes integer DEFAULT 20)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recovered integer := 0;
BEGIN
  UPDATE public.automation_jobs
  SET last_status = 'failed',
      last_message = 'Run exceeded its time budget and was recovered automatically.',
      last_finished_at = now()
  WHERE last_status = 'running'
    AND last_run_at IS NOT NULL
    AND last_run_at < now() - make_interval(mins => GREATEST(_budget_minutes, 1));
  GET DIAGNOSTICS recovered = ROW_COUNT;
  RETURN recovered;
END;
$$;

REVOKE ALL ON FUNCTION public.recover_stale_automation_runs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recover_stale_automation_runs(integer) TO service_role;