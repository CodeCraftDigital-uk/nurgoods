import { createClient } from "@supabase/supabase-js";
import { runStage } from "./src/lib/ai/runtime.server";

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const { data: role } = await sb.from("user_roles").select("user_id").eq("role", "admin").limit(1).single();
const userId = role!.user_id;

const title = "How to choose a gadget gift that actually gets used";
const slug = "how-to-choose-a-gadget-gift-that-actually-gets-used";

const { data: brief, error: be } = await sb.from("article_briefs").insert({
  title,
  target_query: "best gadget gifts uk",
  search_intent: "informational, pre purchase research",
  requires_live_research: false,
  status: "in_review",
}).select("id").single();
if (be) throw be;

const { data: article, error: ae } = await sb.from("articles").insert({
  title, slug, brief_id: brief.id, created_by: userId, stage: "draft", status: "draft",
  author_name: "NUR GOODS Editorial",
  tags: ["gift guides", "gadgets"],
  body_markdown: "",
}).select("id").single();
if (ae) throw ae;
console.log("article", article.id);

for (const stage of ["draft", "optimisation", "internal_links", "metadata_schema"] as const) {
  const r = await runStage(sb as any, { articleId: article.id, stage, userId });
  console.log(stage, r.applied);
}
