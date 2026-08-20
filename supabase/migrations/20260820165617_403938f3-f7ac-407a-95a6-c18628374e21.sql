INSERT INTO public.automation_jobs (job_key, label, description, job_type, enabled, schedule_cron, requires_integration)
VALUES (
  'price_authority_sync',
  'NUR GOODS price authority',
  'Recalculates the authoritative NUR GOODS price for every active variant from verified landed cost, then writes it back to the store so the Shop channel, checkout, headless and the website all advertise the same price.',
  'sync',
  true,
  '17,47 * * * *',
  'shopify'
)
ON CONFLICT (job_key) DO UPDATE
SET enabled = true,
    schedule_cron = EXCLUDED.schedule_cron,
    label = EXCLUDED.label,
    description = EXCLUDED.description;