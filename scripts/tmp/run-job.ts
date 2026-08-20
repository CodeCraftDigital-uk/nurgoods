import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runAutomationJob } from "@/lib/automation/runner.server";
const key = process.argv[2]!;
const r = await runAutomationJob({ supabase: supabaseAdmin as never, userId: null }, key);
console.log(JSON.stringify(r, null, 2));
