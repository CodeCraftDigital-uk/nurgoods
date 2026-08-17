import { supabaseAdmin } from "../../src/integrations/supabase/client.server";
import { runAutomationJob } from "../../src/lib/automation/runner.server";
const r = await runAutomationJob({ supabase: supabaseAdmin as never, userId: null }, "supplier_sourcing_hourly");
console.log(JSON.stringify(r, null, 2));
