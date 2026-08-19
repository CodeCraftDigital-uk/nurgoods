UPDATE public.automation_jobs
SET schedule_cron = '*/5 * * * *', config = jsonb_set(coalesce(config, '{}'::jsonb), '{batch_size}', '25'::jsonb)
WHERE job_key = 'catalogue_intelligence_worker';

UPDATE public.automation_jobs
SET schedule_cron = '15 */2 * * *', config = jsonb_set(coalesce(config, '{}'::jsonb), '{batch_size}', '25'::jsonb)
WHERE job_key = 'catalogue_seo_sweep';

INSERT INTO public.automation_jobs (job_key, label, description, job_type, enabled, schedule_cron, config, next_run_at)
VALUES (
  'catalogue_identity_remediation',
  'Marketplace identity remediation',
  'Checks saved product content in bounded batches and corrects any wording that presents NUR GOODS as the maker or brand of a product.',
  'intelligence',
  true,
  '45 */3 * * *',
  '{"batch_size": 100}'::jsonb,
  null
)
ON CONFLICT (job_key) DO UPDATE
SET enabled = true, schedule_cron = excluded.schedule_cron, config = excluded.config;

SELECT cron.schedule(
  'catalogue-identity-remediation',
  '45 */3 * * *',
  $$
  SELECT net.http_post(
    url:='https://project--b1173cda-d068-4191-a73a-dbe1c3cfe3fc.lovable.app/api/public/hooks/automation',
    headers:='{"Content-Type": "application/json"}'::jsonb,
    body:='{"jobKey": "catalogue_identity_remediation"}'::jsonb
  );
  $$
);

SELECT cron.alter_job(jobid, schedule => '*/5 * * * *')
FROM cron.job WHERE command LIKE '%catalogue_intelligence_worker%';