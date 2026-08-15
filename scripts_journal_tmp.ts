import { createClient } from "@supabase/supabase-js";
import { runStage } from "./src/lib/ai/runtime.server";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const { data: role } = await sb.from("user_roles").select("user_id").eq("role", "admin").limit(1).single();
const userId = role!.user_id;
const { data: article } = await sb.from("articles").select("id").eq("slug", "how-to-choose-a-gadget-gift-that-actually-gets-used").single();
for (const stage of ["draft", "optimisation", "internal_links", "metadata_schema"] as const) {
  const r = await runStage(sb as any, { articleId: article!.id, stage, userId });
  console.log(stage, r.applied);
}
