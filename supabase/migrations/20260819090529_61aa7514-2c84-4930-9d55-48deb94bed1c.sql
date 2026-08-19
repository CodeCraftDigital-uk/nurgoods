UPDATE public.commerce_order_lines
   SET zendrop_line_item_id = '78798030',
       zendrop_product_id = '2772267',
       updated_at = now()
 WHERE id = '985e04ec-53ef-427b-90d3-ee176859cf71'
   AND zendrop_line_item_id IS NULL;

UPDATE public.commerce_orders
   SET orchestration_state = 'supplier_processing',
       supplier_status = 'Processing',
       lines_linked_at = COALESCE(lines_linked_at, now()),
       last_error = NULL,
       updated_at = now()
 WHERE id = '0fd23a56-2108-4b44-b859-8b4a6dc8167c'
   AND orchestration_state = 'manual_review';

INSERT INTO public.commerce_order_events (order_id, from_state, to_state, code, message, detail)
VALUES ('0fd23a56-2108-4b44-b859-8b4a6dc8167c', 'manual_review', 'supplier_processing', 'linkage_repaired',
       'Store line 48159403540810 reconciled to existing supplier line 78798030 on supplier order 44692714. The supplier added thank-you card line is recorded as a supplier only insert. No supplier call was made and nothing was charged.',
       jsonb_build_object('supplier_order_id', '44692714', 'store_line_item_id', '48159403540810', 'supplier_line_item_id', '78798030', 'supplier_insert_lines', jsonb_build_array('TYC-76358978655'), 'mutation', 'internal_data_only'));