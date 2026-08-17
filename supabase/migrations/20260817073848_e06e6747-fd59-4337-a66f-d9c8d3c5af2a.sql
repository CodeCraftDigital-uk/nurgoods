insert into public.automation_jobs (job_key, label, description, job_type, enabled, schedule_cron, config, requires_integration)
values
  ('supplier_sourcing_hourly', 'Hourly supplier sourcing', 'Screens the supplier catalogue every hour, applies the sourcing controls and imports up to 25 fully validated new listings.', 'intelligence', true, '5 * * * *', '{"batch_size": 25}'::jsonb, 'zendrop'),
  ('catalogue_seo_sweep', 'Catalogue search intelligence sweep', 'Requeues listings whose search intelligence is missing, rejected, version drifted or stale, then processes a bounded slice.', 'intelligence', true, '30 */6 * * *', '{"batch_size": 10}'::jsonb, null)
on conflict (job_key) do update set enabled = true, schedule_cron = excluded.schedule_cron, config = excluded.config;

select cron.schedule('nurgoods-supplier-sourcing-hourly', '5 * * * *', $$
  select net.http_post(
    url:='https://project--b1173cda-d068-4191-a73a-dbe1c3cfe3fc.lovable.app/api/public/hooks/automation',
    headers:='{"Content-Type": "application/json", "apikey": "sb_publishable__7arbFSMwsvz1xIHEva1Fw_w8dZDr4E"}'::jsonb,
    body:='{"jobKey": "supplier_sourcing_hourly"}'::jsonb
  ) as request_id;
$$);

select cron.schedule('nurgoods-catalogue-seo-sweep', '30 */6 * * *', $$
  select net.http_post(
    url:='https://project--b1173cda-d068-4191-a73a-dbe1c3cfe3fc.lovable.app/api/public/hooks/automation',
    headers:='{"Content-Type": "application/json", "apikey": "sb_publishable__7arbFSMwsvz1xIHEva1Fw_w8dZDr4E"}'::jsonb,
    body:='{"jobKey": "catalogue_seo_sweep"}'::jsonb
  ) as request_id;
$$);