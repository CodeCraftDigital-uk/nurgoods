SELECT cron.schedule(
  'nurgoods-intake-delta-sync',
  '15 2,14 * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--b1173cda-d068-4191-a73a-dbe1c3cfe3fc.lovable.app/api/public/hooks/automation',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable__7arbFSMwsvz1xIHEva1Fw_w8dZDr4E"}'::jsonb,
    body := '{"jobKey": "product_intake_delta_sync"}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'nurgoods-intake-worker',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--b1173cda-d068-4191-a73a-dbe1c3cfe3fc.lovable.app/api/public/hooks/automation',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable__7arbFSMwsvz1xIHEva1Fw_w8dZDr4E"}'::jsonb,
    body := '{"jobKey": "product_intake_worker"}'::jsonb
  );
  $$
);