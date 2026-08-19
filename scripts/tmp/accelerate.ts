import { supabaseAdmin as db } from "../../src/integrations/supabase/client.server";
const { runHourlySourcing } = await import("../../src/lib/zendrop/sourcing-job.server");
const rounds = Number(process.env["ROUNDS"] ?? "6");
for (let i = 0; i < rounds; i += 1) {
  const t = Date.now();
  try {
    const r = await runHourlySourcing(db as never, "supplier_sourcing_hourly");
    console.log(new Date().toISOString(), "ROUND", i + 1, Math.round((Date.now() - t) / 1000) + "s", JSON.stringify(r));
  } catch (e) {
    console.log(new Date().toISOString(), "ROUND", i + 1, "FAILED", (e as Error).message);
  }
}
console.log("DONE");
