-- Repair scheduled automation delivery.
-- 1. pg_net defaults to a 5 second timeout, which killed every long running
--    job (sourcing, supplier refresh, SEO sweep) before it could report back.
-- 2. The identity remediation entry pointed at a non production host and sent
--    no key, so it was rejected as unauthorised on every run.
-- 3. Two jobs had no schedule entry at all and one had drifted.

DO $$
DECLARE
  _url text := 'https://nurgoods.com/api/public/hooks/automation';
  _key text := 'sb_publishable__7arbFSMwsvz1xIHEva1Fw_w8dZDr4E';
  _hdr jsonb;
  _rec record;
  _spec record;
BEGIN
  _hdr := jsonb_build_object('Content-Type','application/json','apikey',_key);

  FOR _spec IN
    SELECT * FROM (VALUES
      ('nurgoods-monthly-editorial-plan','monthly_editorial_plan','0 6 1 * *',30000),
      ('nurgoods-daily-article-publish','daily_article_publish','0 7 * * *',120000),
      ('nurgoods-intelligence-worker','catalogue_intelligence_worker','*/5 * * * *',120000),
      ('nurgoods-duplicate-identity','catalogue_duplicate_identity','*/20 * * * *',60000),
      ('nurgoods-intelligence-daily','catalogue_intelligence_daily','0 3 * * *',120000),
      ('nurgoods-quality-audit','catalogue_quality_audit','0 4 * * 1',120000),
      ('nurgoods-intake-delta-sync','product_intake_delta_sync','0 */6 * * *',120000),
      ('nurgoods-intake-worker','product_intake_worker','7,22,37,52 * * * *',120000),
      ('nurgoods-supplier-sourcing-hourly','supplier_sourcing_hourly','*/15 * * * *',180000),
      ('nurgoods-catalogue-seo-sweep','catalogue_seo_sweep','15 */2 * * *',120000),
      ('nurgoods-prohibited-category-sweep','prohibited_category_sweep','20 * * * *',60000),
      ('nurgoods-live-pricing-integrity','live_pricing_integrity','*/30 * * * *',120000),
      ('nurgoods-order-fulfilment-queue','order_fulfilment_queue','11,41 * * * *',120000),
      ('nurgoods-order-tracking-sync','order_tracking_sync','26,56 * * * *',120000),
      ('catalogue-identity-remediation','catalogue_identity_remediation','45 */3 * * *',120000),
      ('nurgoods-supplier-product-refresh','supplier_product_refresh','17,47 * * * *',180000),
      ('nurgoods-intelligence-backfill','catalogue_intelligence_backfill','*/10 * * * *',120000),
      ('nurgoods-shopify-catalogue-sync','shopify_catalogue_sync','40 */4 * * *',180000)
    ) AS t(jobname, jobkey, sched, ms)
  LOOP
    FOR _rec IN SELECT jobid FROM cron.job WHERE jobname = _spec.jobname LOOP
      PERFORM cron.unschedule(_rec.jobid);
    END LOOP;

    PERFORM cron.schedule(
      _spec.jobname,
      _spec.sched,
      format(
        'select net.http_post(url:=%L, headers:=%L::jsonb, body:=%L::jsonb, timeout_milliseconds:=%s);',
        _url, _hdr::text, json_build_object('jobKey', _spec.jobkey)::text, _spec.ms
      )
    );

    UPDATE public.automation_jobs
       SET schedule_cron = _spec.sched
     WHERE job_key = _spec.jobkey;
  END LOOP;
END $$;