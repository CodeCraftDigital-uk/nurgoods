insert into public.automation_jobs (job_key, label, description, job_type, enabled, schedule_cron, config, requires_integration)
values
  ('prohibited_category_sweep', 'Prohibited category sweep', 'Scans the catalogue for prohibited adult or sexual products, removes them from every sales channel, sets them to draft and quarantines them with the reason.', 'intelligence', true, '20 * * * *', '{}'::jsonb, 'shopify')
on conflict (job_key) do update set enabled = true, schedule_cron = excluded.schedule_cron, label = excluded.label, description = excluded.description;

select cron.schedule('nurgoods-prohibited-category-sweep', '20 * * * *', $$
  select net.http_post(
    url:='https://project--b1173cda-d068-4191-a73a-dbe1c3cfe3fc.lovable.app/api/public/hooks/automation',
    headers:='{"Content-Type": "application/json", "apikey": "sb_publishable__7arbFSMwsvz1xIHEva1Fw_w8dZDr4E"}'::jsonb,
    body:='{"jobKey": "prohibited_category_sweep"}'::jsonb
  ) as request_id;
$$);

drop policy if exists "Staff read classifications" on public.product_classifications;
create policy "Staff read classifications" on public.product_classifications
for select to authenticated
using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'staff') or public.has_role(auth.uid(),'viewer'));

drop policy if exists "Staff read correction history" on public.product_classification_history;
create policy "Staff read correction history" on public.product_classification_history
for select to authenticated
using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'staff') or public.has_role(auth.uid(),'viewer'));

drop policy if exists "Staff read product seo" on public.product_seo_intelligence;
create policy "Staff read product seo" on public.product_seo_intelligence
for select to authenticated
using (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'staff') or public.has_role(auth.uid(),'viewer'));