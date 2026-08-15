import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const { data: a } = await sb.from("articles").select("*").eq("slug","how-to-choose-a-gadget-gift-that-actually-gets-used").single();
console.log(a!.title,"|",a!.meta_title,"|",a!.meta_description);
console.log("EXCERPT:",a!.excerpt);
console.log("FAQS:",JSON.stringify(a!.faqs).slice(0,600));
console.log("BODY:\n",a!.body_markdown);
const { data: links } = await sb.from("article_internal_links").select("anchor_text,target_type,target_reference").eq("article_id",a!.id);
console.log(links);
