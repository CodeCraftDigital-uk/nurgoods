import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { revalidateQuarantined } from "@/lib/intake/intake.server";
const r = await revalidateQuarantined(supabaseAdmin as never, 300);
console.log(JSON.stringify(r, null, 2));
