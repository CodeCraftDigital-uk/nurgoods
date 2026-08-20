const { createClient } = await import("@supabase/supabase-js");
const url = process.env["SUPABASE_URL"]!;
const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
console.log("has url", Boolean(url), "has pub", Boolean(key), "has service", Boolean(process.env["SUPABASE_SERVICE_ROLE_KEY"]));
const c = createClient(url, key!, { auth: { persistSession: false } });
const r = await c.from("legal_documents").select("slug,status,is_placeholder").limit(5);
console.log("legal_documents", JSON.stringify(r.data ?? r.error));
const s = await c.from("shopify_legal_sources").select("slug,is_published,public_visible").limit(5);
console.log("legal_sources", JSON.stringify(s.data ?? s.error));
