create table if not exists public.storefront_checkout_state (
  id boolean primary key default true check (id),
  checkout_domain text,
  checkout_ready boolean not null default false,
  storefront_checkout boolean not null default false,
  checked_at timestamptz not null default now()
);

grant select on public.storefront_checkout_state to anon, authenticated;
grant all on public.storefront_checkout_state to service_role;

alter table public.storefront_checkout_state enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='storefront_checkout_state' and policyname='Checkout state is publicly readable') then
    create policy "Checkout state is publicly readable"
      on public.storefront_checkout_state for select
      to anon, authenticated using (true);
  end if;
end $$;

insert into public.storefront_checkout_state (id) values (true) on conflict (id) do nothing;