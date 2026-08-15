
-- ============ SECURE INTEGRATION SECRETS (VAULT) ============
create or replace function public.set_integration_secret(_name text, _secret text)
returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  _id uuid;
begin
  select id into _id from vault.secrets where name = _name;
  if _id is null then
    perform vault.create_secret(_secret, _name, 'NUR GOODS integration credential');
  else
    perform vault.update_secret(_id, _secret, _name, 'NUR GOODS integration credential');
  end if;
end;
$$;

create or replace function public.get_integration_secret(_name text)
returns text
language sql
security definer
set search_path = public, vault, extensions
as $$
  select decrypted_secret from vault.decrypted_secrets where name = _name limit 1;
$$;

create or replace function public.delete_integration_secret(_name text)
returns void
language sql
security definer
set search_path = public, vault, extensions
as $$
  delete from vault.secrets where name = _name;
$$;

revoke all on function public.set_integration_secret(text, text) from public, anon, authenticated;
revoke all on function public.get_integration_secret(text) from public, anon, authenticated;
revoke all on function public.delete_integration_secret(text) from public, anon, authenticated;
grant execute on function public.set_integration_secret(text, text) to service_role;
grant execute on function public.get_integration_secret(text) to service_role;
grant execute on function public.delete_integration_secret(text) to service_role;

-- ============ RICHER CATALOGUE MIRROR ============
alter table public.shopify_products
  add column if not exists description text,
  add column if not exists description_html text,
  add column if not exists seo_title text,
  add column if not exists seo_description text,
  add column if not exists online_store_url text,
  add column if not exists compare_at_price_min numeric(12,2),
  add column if not exists compare_at_price_max numeric(12,2),
  add column if not exists available_for_sale boolean,
  add column if not exists total_inventory integer,
  add column if not exists options jsonb not null default '[]'::jsonb;

grant select (description, description_html, seo_title, seo_description, online_store_url,
              compare_at_price_min, compare_at_price_max, available_for_sale, total_inventory, options)
  on public.shopify_products to anon;

alter table public.shopify_collections
  add column if not exists seo_title text,
  add column if not exists seo_description text,
  add column if not exists description_html text;

grant select (seo_title, seo_description, description_html) on public.shopify_collections to anon;

create table if not exists public.shopify_product_media (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.shopify_products(id) on delete cascade,
  shopify_media_id text not null,
  position integer not null default 0,
  media_type text,
  url text not null,
  alt_text text,
  width integer,
  height integer,
  created_at timestamptz not null default now(),
  unique (product_id, shopify_media_id)
);
grant select, insert, update, delete on public.shopify_product_media to authenticated;
grant all on public.shopify_product_media to service_role;
alter table public.shopify_product_media enable row level security;
create policy "Admins manage product media" on public.shopify_product_media for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create policy "Media of public products is public" on public.shopify_product_media for select to anon, authenticated
  using (exists (select 1 from public.shopify_products p
                 where p.id = shopify_product_media.product_id
                   and p.status = 'active' and p.sync_status = 'synced'));
revoke select on public.shopify_product_media from anon;
grant select (id, product_id, position, media_type, url, alt_text, width, height)
  on public.shopify_product_media to anon;

create table if not exists public.shopify_product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.shopify_products(id) on delete cascade,
  shopify_variant_id text not null unique,
  title text not null,
  position integer not null default 0,
  price numeric(12,2),
  compare_at_price numeric(12,2),
  currency text,
  sku text,
  image_url text,
  selected_options jsonb not null default '[]'::jsonb,
  available_for_sale boolean,
  inventory_quantity integer,
  shopify_updated_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.shopify_product_variants to authenticated;
grant all on public.shopify_product_variants to service_role;
alter table public.shopify_product_variants enable row level security;
create policy "Admins manage product variants" on public.shopify_product_variants for all to authenticated
  using (public.has_role(auth.uid(),'admin')) with check (public.has_role(auth.uid(),'admin'));
create policy "Variants of public products are public" on public.shopify_product_variants for select to anon, authenticated
  using (exists (select 1 from public.shopify_products p
                 where p.id = shopify_product_variants.product_id
                   and p.status = 'active' and p.sync_status = 'synced'));
revoke select on public.shopify_product_variants from anon;
grant select (id, product_id, title, position, price, compare_at_price, currency, image_url,
              selected_options, available_for_sale, shopify_updated_at)
  on public.shopify_product_variants to anon;

create index if not exists shopify_product_media_product_idx on public.shopify_product_media(product_id, position);
create index if not exists shopify_product_variants_product_idx on public.shopify_product_variants(product_id, position);
