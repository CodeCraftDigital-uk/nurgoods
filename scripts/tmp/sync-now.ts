import { syncCatalogue, markConnectionState, recordSyncEvent } from "../../src/lib/services/shopify.server";
const { supabaseAdmin } = await import("../../src/integrations/supabase/client.server");
try {
  const r = await syncCatalogue(supabaseAdmin as never);
  console.log("SYNC", JSON.stringify(r));
  await recordSyncEvent(supabaseAdmin as never, { status: "success", message: `Mirrored ${r.products} products and ${r.collections} collections.`, payload: { products: r.products, collections: r.collections } });
  await markConnectionState({ state: "connected", error: null, syncedAt: r.syncedAt });
} catch (e) { console.log("FAIL", (e as Error).message); }
