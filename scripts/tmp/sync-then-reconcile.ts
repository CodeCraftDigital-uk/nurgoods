import { syncCatalogue } from "../../src/lib/services/shopify.server";
import { supabaseAdmin } from "../../src/integrations/supabase/client.server";
import { reconcileImportedCandidates } from "../../src/lib/zendrop/import.server";
console.log(JSON.stringify(await syncCatalogue(supabaseAdmin as never)).slice(0,600));
console.log("matched", await reconcileImportedCandidates());
