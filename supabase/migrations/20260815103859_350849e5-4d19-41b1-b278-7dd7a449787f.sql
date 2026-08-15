drop policy if exists "Approved questions on public content are public" on public.seo_questions;

create policy "Approved questions on public content are public"
on public.seo_questions
for select
to anon, authenticated
using (
  include_in_faq_schema = true
  and exists (
    select 1
    from public.seo_records r
    where r.id = seo_questions.seo_record_id
      and (
        exists (
          select 1 from public.articles a
          where r.target_type = 'article'::seo_target_type
            and a.slug = r.target_reference
            and a.status = 'published'::workflow_status
            and a.published_at is not null
        )
        or exists (
          select 1 from public.shopify_products p
          where r.target_type = 'product'::seo_target_type
            and p.handle = r.target_reference
            and p.status = 'active'
            and p.sync_status = 'synced'::sync_status
        )
        or exists (
          select 1 from public.shopify_collections c
          where r.target_type = 'collection'::seo_target_type
            and c.handle = r.target_reference
            and c.sync_status = 'synced'::sync_status
        )
      )
  )
);

grant select on public.shopify_product_collections to anon;

drop policy if exists "Public product collection links are readable" on public.shopify_product_collections;

create policy "Public product collection links are readable"
on public.shopify_product_collections
for select
to anon, authenticated
using (
  exists (
    select 1 from public.shopify_products p
    where p.id = shopify_product_collections.product_id
      and p.status = 'active'
      and p.sync_status = 'synced'::sync_status
  )
  and exists (
    select 1 from public.shopify_collections c
    where c.id = shopify_product_collections.collection_id
      and c.sync_status = 'synced'::sync_status
  )
);