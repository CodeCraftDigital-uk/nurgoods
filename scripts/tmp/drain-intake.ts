import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { runIntakeWorker } from "@/lib/intake/jobs.server";
const deadline = Date.now() + 480_000;
let n = 0;
while (Date.now() < deadline && n < 20) {
  const r = await runIntakeWorker(supabaseAdmin as never, 8);
  console.log(n, r.message);
  n += 1;
  if (String(r.message).startsWith("Nothing was waiting")) break;
}
