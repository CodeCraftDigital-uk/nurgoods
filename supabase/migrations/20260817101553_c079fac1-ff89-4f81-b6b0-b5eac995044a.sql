drop view if exists public.public_product_categories;

create or replace view public.public_product_categories
with (security_invoker = true)
as
select pc.product_id, pc.category_slug
from public.product_classifications pc
where pc.auto_published = true
  and pc.category_slug is not null;

grant select on public.public_product_categories to anon, authenticated;
grant all on public.public_product_categories to service_role;

grant select (product_id, category_slug, auto_published) on public.product_classifications to anon;

create policy "Public category lookup only"
on public.product_classifications
for select
to anon
using (auto_published = true and category_slug is not null);