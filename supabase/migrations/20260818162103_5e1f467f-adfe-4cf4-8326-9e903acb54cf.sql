delete from public.commerce_order_events where order_id in (select id from public.commerce_orders where shopify_order_id = 'gid://shopify/Order/9900000000001');
delete from public.commerce_order_lines where order_id in (select id from public.commerce_orders where shopify_order_id = 'gid://shopify/Order/9900000000001');
delete from public.commerce_orders where shopify_order_id = 'gid://shopify/Order/9900000000001';
delete from public.commerce_webhook_deliveries where webhook_id like 'synthetic-test-%';