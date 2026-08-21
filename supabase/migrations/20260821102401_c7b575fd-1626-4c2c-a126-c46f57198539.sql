-- Legacy catalogue architecture cleanup: retire schedules superseded by the
-- Shopify-led model. Job code stays callable by hand; only the timers go.
SELECT cron.unschedule('nurgoods-sellability-hold');
SELECT cron.unschedule('nurgoods-supplier-link-recovery');
SELECT cron.unschedule('nurgoods-supplier-sourcing-hourly');
SELECT cron.unschedule('nurgoods-supplier-product-refresh');

-- Pricing integrity becomes a daily safety net; the bounded pricing worker
-- (price_authority_sync) is the routine path.
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'nurgoods-live-pricing-integrity'),
  schedule := '25 4 * * *'
);