SELECT cron.schedule(
  'nurgoods-supplier-product-refresh',
  '17,47 * * * *',
  $$
  select net.http_post(
    url:='https://nurgoods.com/api/public/hooks/automation',
    headers:='{"Content-Type": "application/json", "apikey": "sb_publishable__7arbFSMwsvz1xIHEva1Fw_w8dZDr4E"}'::jsonb,
    body:='{"jobKey": "supplier_product_refresh"}'::jsonb
  ) as request_id;
  $$
);
SELECT cron.alter_job(jobid, active := true) FROM cron.job WHERE jobname = 'nurgoods-supplier-sourcing-hourly';