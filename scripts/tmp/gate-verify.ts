import { zendropAdminClient } from "../../src/lib/zendrop/client.server";
const supabase = await zendropAdminClient();
const g: any = await supabase.rpc("pricing_gate_stats" as never);
console.log("gate", JSON.stringify(g.data));
const { data: bad } = await supabase.rpc("exec_sql" as never).catch(() => ({ data: null }));
