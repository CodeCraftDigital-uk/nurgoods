import { supabaseAdmin as db } from "../../src/integrations/supabase/client.server";
const before = await db.from("zendrop_sourcing_rules").select("*").maybeSingle();
console.log("RULES_BEFORE", JSON.stringify({ enabled: (before.data as any)?.enabled, continuous: (before.data as any)?.continuous_sourcing, batch: (before.data as any)?.batch_size }));
const id = (before.data as any).id;
await db.from("zendrop_sourcing_rules").update({ enabled: true, continuous_sourcing: true } as never).eq("id", id);
try {
  const { runHourlySourcing } = await import("../../src/lib/zendrop/sourcing-job.server");
  const r = await runHourlySourcing(db as never, "supplier_sourcing_hourly");
  console.log("RESULT", JSON.stringify(r, null, 2));
} catch (e) {
  console.log("FAILED", (e as Error).message);
  await db.from("zendrop_sourcing_rules").update({ enabled: false, continuous_sourcing: false } as never).eq("id", id);
  console.log("REVERTED");
}
