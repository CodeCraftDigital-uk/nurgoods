CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'nurgoods-intelligence-worker',
  '*/10 * * * *',
  $$
  select net.http_post(
    url:='https://project--b1173cda-d068-4191-a73a-dbe1c3cfe3fc.lovable.app/api/public/hooks/automation',
    headers:='{"Content-Type": "application/json", "apikey": "sb_publishable__7arbFSMwsvz1xIHEva1Fw_w8dZDr4E"}'::jsonb,
    body:='{"jobKey": "catalogue_intelligence_worker"}'::jsonb
  ) as request_id;
  $$
);

SELECT cron.schedule(
  'nurgoods-duplicate-identity',
  '*/20 * * * *',
  $$
  select net.http_post(
    url:='https://project--b1173cda-d068-4191-a73a-dbe1c3cfe3fc.lovable.app/api/public/hooks/automation',
    headers:='{"Content-Type": "application/json", "apikey": "sb_publishable__7arbFSMwsvz1xIHEva1Fw_w8dZDr4E"}'::jsonb,
    body:='{"jobKey": "catalogue_duplicate_identity"}'::jsonb
  ) as request_id;
  $$
);

SELECT cron.schedule(
  'nurgoods-intelligence-daily',
  '0 3 * * *',
  $$
  select net.http_post(
    url:='https://project--b1173cda-d068-4191-a73a-dbe1c3cfe3fc.lovable.app/api/public/hooks/automation',
    headers:='{"Content-Type": "application/json", "apikey": "sb_publishable__7arbFSMwsvz1xIHEva1Fw_w8dZDr4E"}'::jsonb,
    body:='{"jobKey": "catalogue_intelligence_daily"}'::jsonb
  ) as request_id;
  $$
);

SELECT cron.schedule(
  'nurgoods-quality-audit',
  '0 4 * * 1',
  $$
  select net.http_post(
    url:='https://project--b1173cda-d068-4191-a73a-dbe1c3cfe3fc.lovable.app/api/public/hooks/automation',
    headers:='{"Content-Type": "application/json", "apikey": "sb_publishable__7arbFSMwsvz1xIHEva1Fw_w8dZDr4E"}'::jsonb,
    body:='{"jobKey": "catalogue_quality_audit"}'::jsonb
  ) as request_id;
  $$
);
