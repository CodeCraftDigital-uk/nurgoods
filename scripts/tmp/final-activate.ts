import { supabaseAdmin as db } from "../../src/integrations/supabase/client.server";
const { runPublicationAudit } = await import("../../src/lib/zendrop/publication-audit.server");
const audit = await runPublicationAudit({ limit: 300 } as never).catch((e:Error)=>({error:e.message}) as never);
console.log("AUDIT", JSON.stringify((audit as any).summary ?? audit).slice(0,800));
const s = await db.from("commerce_settings").update({ auto_fulfilment_enabled: true } as never).neq("id","").select("*");
console.log("SETTINGS", JSON.stringify(s.data ?? s.error));
const me = await db.from("product_market_eligibility").select("market,eligible").limit(2000);
const t: Record<string,number> = {}; for (const r of (me.data ?? []) as any[]) { const k = `${r.market}:${r.eligible}`; t[k]=(t[k]??0)+1; }
console.log("MARKETS", JSON.stringify(t));
const { count } = await db.from("shopify_products").select("*", { count: "exact", head: true }).eq("status","active");
console.log("ACTIVE", count);
const rules = await db.from("zendrop_sourcing_rules").select("enabled,continuous_sourcing,batch_size").maybeSingle();
console.log("RULES", JSON.stringify(rules.data));
