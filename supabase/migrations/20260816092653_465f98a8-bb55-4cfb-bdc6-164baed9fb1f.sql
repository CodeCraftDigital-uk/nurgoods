insert into public.integration_settings (integration_id, key, label, value, is_secret_reference, help_text)
select i.id, 'checkout_domain', 'Checkout domain', 'shop.nurgoods.com', false,
  'Host the store serves basket and payment pages on. Used only once it answers as the store.'
from public.integrations i
where i.provider = 'shopify'
on conflict (integration_id, key) do nothing;