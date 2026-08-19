WITH fixed AS (
  UPDATE public.commerce_orders
     SET orchestration_state = 'awaiting_fulfilment_preview',
         last_error = NULL,
         updated_at = now()
   WHERE shopify_order_id = 'gid://shopify/Order/18062324236618'
     AND shopify_order_number = 1002
     AND orchestration_state = 'manual_review'
     AND submitted_at IS NULL
     AND zendrop_fulfillment_operation_id IS NULL
   RETURNING id
)
INSERT INTO public.commerce_order_events (order_id, from_state, to_state, code, message)
SELECT id, 'manual_review', 'awaiting_fulfilment_preview', 'variant_mapping_corrected',
       'Supplier variant matching now reads long and short store references as the same reference, and supplier facts for this listing were refreshed, so the order returns to the normal fulfilment queue.'
FROM fixed;