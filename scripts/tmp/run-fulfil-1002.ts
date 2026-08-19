import { runOrderFulfilmentQueue } from "../../src/lib/commerce/jobs.server";
import { supabaseAdmin } from "../../src/integrations/supabase/client.server";
const report = await runOrderFulfilmentQueue(supabaseAdmin as never);
console.log(JSON.stringify(report, null, 2));
