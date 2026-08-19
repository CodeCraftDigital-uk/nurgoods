import { supabaseAdmin } from '@/integrations/supabase/client.server';
const { data, error } = await supabaseAdmin.from('automation_jobs').update({ enabled: true }).eq('job_key','order_fulfilment_queue').select('job_key,enabled');
console.log(JSON.stringify({ data, error }));
