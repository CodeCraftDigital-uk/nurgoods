drop policy if exists "Published classifications are public" on public.product_classifications;

revoke select on public.product_classifications from anon;

create or replace view public.public_product_categories
with (security_invoker = false)
as
select pc.product_id, pc.category_slug
from public.product_classifications pc
where pc.auto_published = true
  and pc.category_slug is not null;

grant select on public.public_product_categories to anon, authenticated;
grant all on public.public_product_categories to service_role;