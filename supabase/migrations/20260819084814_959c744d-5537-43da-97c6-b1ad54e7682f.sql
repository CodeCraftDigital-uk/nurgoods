WITH fixed AS (
  UPDATE public.commerce_orders
     SET orchestration_state = 'awaiting_fulfilment_preview',
         last_error = NULL,
         lines_linked_at = NULL,
         updated_at = now()
   WHERE shopify_order_id = 'gid://shopify/Order/18062324236618'
     AND shopify_order_number = 1002
     AND orchestration_state = 'supplier_processing'
     AND dispatch_idempotency_key IS NULL
     AND submitted_at IS NULL
     AND zendrop_fulfillment_operation_id IS NULL
   RETURNING id
)
INSERT INTO public.commerce_order_events (order_id, from_state, to_state, code, message)
SELECT id, 'supplier_processing', 'awaiting_fulfilment_preview', 'linkage_corrected',
       'Corrected a misread supplier status. The supplier order is Unfulfilled, so this order returns to the normal fulfilment queue against the existing supplier order.'
FROM fixed;