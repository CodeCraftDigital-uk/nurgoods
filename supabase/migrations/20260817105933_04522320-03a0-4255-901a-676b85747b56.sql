-- 1. Public category lookup without exposing internal classification work product
ALTER VIEW public.public_product_categories SET (security_invoker = false);
GRANT SELECT ON public.public_product_categories TO anon, authenticated;
DROP POLICY IF EXISTS "Public category lookup only" ON public.product_classifications;
REVOKE SELECT ON public.product_classifications FROM anon;

-- 2. Supplier cost data must never reach the browser
REVOKE SELECT ON public.shopify_product_variants FROM anon, authenticated;
GRANT SELECT (
  id, product_id, shopify_variant_id, title, position, price, compare_at_price,
  currency, sku, image_url, selected_options, available_for_sale,
  inventory_quantity, shopify_updated_at, last_synced_at, created_at, barcode
) ON public.shopify_product_variants TO anon, authenticated;
GRANT ALL ON public.shopify_product_variants TO service_role;

-- 3. Raw supplier sync payload stays private
REVOKE SELECT ON public.shopify_products FROM anon, authenticated;
GRANT SELECT (
  id, shopify_product_id, handle, title, product_type, vendor, status, tags,
  featured_image_url, price_min, price_max, currency, variant_count,
  shopify_updated_at, sync_status, last_synced_at, created_at, updated_at,
  description, description_html, seo_title, seo_description, online_store_url,
  compare_at_price_min, compare_at_price_max, available_for_sale,
  total_inventory, options
) ON public.shopify_products TO anon, authenticated;
GRANT ALL ON public.shopify_products TO service_role;

-- 4. Credential vault helpers are server-only
REVOKE EXECUTE ON FUNCTION public.get_integration_secret(text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.set_integration_secret(text, text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.delete_integration_secret(text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, public;

-- 5. Advertised price range always follows the live variant prices
CREATE OR REPLACE FUNCTION public.refresh_product_price_range(_product_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.shopify_products p
  SET price_min = agg.min_price,
      price_max = agg.max_price,
      compare_at_price_min = agg.min_compare
  FROM (
    SELECT
      COALESCE(MIN(v.price) FILTER (WHERE v.available_for_sale), MIN(v.price)) AS min_price,
      COALESCE(MAX(v.price) FILTER (WHERE v.available_for_sale), MAX(v.price)) AS max_price,
      COALESCE(
        MIN(v.compare_at_price) FILTER (WHERE v.available_for_sale AND v.compare_at_price IS NOT NULL),
        MIN(v.compare_at_price) FILTER (WHERE v.compare_at_price IS NOT NULL)
      ) AS min_compare
    FROM public.shopify_product_variants v
    WHERE v.product_id = _product_id
  ) agg
  WHERE p.id = _product_id
    AND agg.min_price IS NOT NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.refresh_product_price_range(uuid) FROM anon, authenticated, public;

CREATE OR REPLACE FUNCTION public.sync_product_price_range()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.refresh_product_price_range(COALESCE(NEW.product_id, OLD.product_id));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS shopify_product_variants_price_range ON public.shopify_product_variants;
CREATE TRIGGER shopify_product_variants_price_range
AFTER INSERT OR UPDATE OF price, compare_at_price, available_for_sale OR DELETE
ON public.shopify_product_variants
FOR EACH ROW EXECUTE FUNCTION public.sync_product_price_range();

-- Backfill every product so no card advertises a stale price
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT product_id FROM public.shopify_product_variants LOOP
    PERFORM public.refresh_product_price_range(r.product_id);
  END LOOP;
END;
$$;