import { supabaseAdmin } from "../../src/integrations/supabase/client.server";
import { runAutomationJob } from "../../src/lib/automation/runner.server";
console.log(JSON.stringify(await runAutomationJob({ supabase: supabaseAdmin as never, userId: null }, "product_intake_delta_sync"), null, 2));
