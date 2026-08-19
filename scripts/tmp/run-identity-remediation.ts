import { createClient } from "@supabase/supabase-js";
import { runIdentityRemediation } from "../../src/lib/intelligence/jobs.server";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

let round = 0;
while (round < 5) {
  round += 1;
  const summary = await runIdentityRemediation(db as never, 100);
  console.log(round, summary.message, JSON.stringify(summary.details));
  if ((summary.details as any).audited < 100) break;
}
