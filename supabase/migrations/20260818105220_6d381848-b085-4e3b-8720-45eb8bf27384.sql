select cron.schedule(
  'nurgoods-order-fulfilment-queue',
  '*/10 * * * *',
  $$
  select net.http_post(
    url:='https://nurgoods.com/api/public/hooks/automation',
    headers:='{"Content-Type": "application/json", "apikey": "sb_publishable__7arbFSMwsvz1xIHEva1Fw_w8dZDr4E"}'::jsonb,
    body:='{"jobKey": "order_fulfilment_queue"}'::jsonb
  ) as request_id;
  $$
);

select cron.schedule(
  'nurgoods-order-tracking-sync',
  '*/30 * * * *',
  $$
  select net.http_post(
    url:='https://nurgoods.com/api/public/hooks/automation',
    headers:='{"Content-Type": "application/json", "apikey": "sb_publishable__7arbFSMwsvz1xIHEva1Fw_w8dZDr4E"}'::jsonb,
    body:='{"jobKey": "order_tracking_sync"}'::jsonb
  ) as request_id;
  $$
);