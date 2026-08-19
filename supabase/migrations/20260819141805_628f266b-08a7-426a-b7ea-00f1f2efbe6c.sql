-- The public product policy exposed every column of shopify_products to
-- anonymous readers, including the untouched supplier sync payload in `raw`,
-- which can carry internal identifiers and cost hints. No storefront code
-- reads that column, so anonymous access is narrowed to the display columns.
REVOKE SELECT ON public.shopify_products FROM anon;
GRANT SELECT (
  id, shopify_product_id, handle, title, product_type, vendor, status, tags,
  featured_image_url, price_min, price_max, currency, variant_count,
  shopify_updated_at, sync_status, last_synced_at, created_at, updated_at,
  description, description_html, seo_title, seo_description,
  compare_at_price_min, compare_at_price_max, available_for_sale,
  total_inventory, options
) ON public.shopify_products TO anon;