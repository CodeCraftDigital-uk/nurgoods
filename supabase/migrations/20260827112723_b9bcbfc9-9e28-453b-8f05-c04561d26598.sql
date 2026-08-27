CREATE INDEX IF NOT EXISTS pricing_audit_items_product_id_idx ON public.pricing_audit_items (product_id);
CREATE INDEX IF NOT EXISTS product_price_revisions_product_id_idx ON public.product_price_revisions (product_id);
CREATE INDEX IF NOT EXISTS zendrop_import_candidates_product_id_idx ON public.zendrop_import_candidates (product_id);
CREATE INDEX IF NOT EXISTS duplicate_groups_canonical_product_id_idx ON public.duplicate_groups (canonical_product_id);
CREATE INDEX IF NOT EXISTS product_classifications_duplicate_of_product_id_idx ON public.product_classifications (duplicate_of_product_id);