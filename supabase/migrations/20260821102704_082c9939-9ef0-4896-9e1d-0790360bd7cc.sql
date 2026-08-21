-- The bounded pricing worker had no timer, so store cost of goods was only
-- ever reconciled by hand. Schedule it hourly.
SELECT cron.schedule(
  'nurgoods-price-authority',
  '35 * * * *',
  $$select net.http_post(
      url:='https://nurgoods.com/api/public/hooks/automation',
      headers:='{"apikey": "sb_publishable__7arbFSMwsvz1xIHEva1Fw_w8dZDr4E", "Content-Type": "application/json"}'::jsonb,
      body:='{"jobKey" : "price_authority_sync"}'::jsonb,
      timeout_milliseconds:=60000);$$
);