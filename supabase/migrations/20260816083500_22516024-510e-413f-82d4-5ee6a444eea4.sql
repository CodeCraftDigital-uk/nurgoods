insert into public.integration_settings (integration_id, key, label, value, is_secret_reference)
select i.id, 'storefront_primary_domain', 'Storefront checkout host', 'nurgoods.com', false
from public.integrations i where i.provider = 'shopify'
on conflict (integration_id, key) do update set value = excluded.value, label = excluded.label;