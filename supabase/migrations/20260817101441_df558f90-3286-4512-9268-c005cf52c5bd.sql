insert into public.automation_jobs (job_key, label, description, job_type, enabled, schedule_cron, config)
values (
  'live_pricing_integrity',
  'Live pricing integrity',
  'Checks every active listing price directly against the commerce system, corrects any price that does not match the approved formula and takes any listing without a verified landed cost off sale.',
  'intelligence',
  true,
  '*/30 * * * *',
  '{}'::jsonb
)
on conflict (job_key) do update
set label = excluded.label,
    description = excluded.description,
    enabled = true,
    schedule_cron = excluded.schedule_cron;