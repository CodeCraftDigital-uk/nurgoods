import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveAdapter } from "@/lib/ai/runtime.server";

/**
 * Automated editorial engine.
 *
 * The monthly planner builds a forward topic plan from the genuine synced
 * catalogue and existing coverage. The daily publisher takes the next planned
 * topic, writes the article, produces a hero image, runs deterministic quality
 * checks and publishes when every check passes. Nothing waits for a person,
 * but nothing broken or unsupported reaches the public Journal either.
 */

type Db = SupabaseClient<any, "public", any>;

const BRAND_RULES = [
  "You write for NUR GOODS, a premium, calm and trustworthy retail brand.",
  "Tagline: Good things, brought to light.",
  "British English. Warm, plain, human editorial voice. No hype, no filler, no keyword stuffing.",
  "Never use em dashes anywhere.",
  "Never invent products, prices, availability, specifications, reviews, statistics, quotes, laws or news.",
  "Only reference catalogue items supplied in the context, by their exact handle.",
  "Write timeless, evergreen guidance rather than current events reporting.",
  "Return strict JSON only, with no commentary and no code fences.",
].join(" ");

/* ------------------------------ helpers ------------------------------ */

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function stripEmDashes(value: string): string {
  return value.replace(/\s*[—–]\s*/g, ", ").replace(/\s+,/g, ",");
}

function stringArray(value: unknown, limit = 12): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, limit);
}

function readingMinutes(body: string): number {
  return Math.max(1, Math.round(body.split(/\s+/).length / 210));
}

/* --------------------------- monthly planner --------------------------- */

export interface PlanResult {
  created: number;
  month: string;
  skipped: number;
}

interface PlannedTopic {
  title: string;
  targetQuery?: string;
  searchIntent?: string;
  audience?: string;
  angle?: string;
  keywords?: string[];
  relatedHandles?: string[];
}

/** Builds the forward Journal plan for a month, one topic per planned day. */
export async function planMonthlyEditorial(
  supabase: Db,
  input: { userId: string | null; month?: string; topics?: number },
): Promise<PlanResult> {
  const now = new Date();
  const monthStart = input.month
    ? new Date(`${input.month}-01T00:00:00Z`)
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthKey = monthStart.toISOString().slice(0, 10);

  const daysInMonth = new Date(
    Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0),
  ).getUTCDate();

  // Only plan days that have not already passed, so a mid month run does not
  // create a backlog of dated topics that can never publish on time.
  const firstDay =
    monthStart.getUTCFullYear() === now.getUTCFullYear() &&
    monthStart.getUTCMonth() === now.getUTCMonth()
      ? now.getUTCDate()
      : 1;
  const wanted = Math.min(input.topics ?? daysInMonth - firstDay + 1, 31);
  if (wanted <= 0) return { created: 0, month: monthKey, skipped: 0 };

  const [products, collections, articles, existingPlan] = await Promise.all([
    supabase.from("shopify_products").select("handle,title,product_type,tags").limit(80),
    supabase.from("shopify_collections").select("handle,title,description").limit(40),
    supabase.from("articles").select("title,slug,tags"),
    supabase.from("editorial_plan_items").select("title"),
  ]);

  const firstError =
    products.error ?? collections.error ?? articles.error ?? existingPlan.error ?? null;
  if (firstError) throw new Error(firstError.message);

  const catalogue = [
    ...(products.data ?? []).map(
      (row: any) =>
        `product ${row.handle}: ${row.title}${row.product_type ? ` (${row.product_type})` : ""}`,
    ),
    ...(collections.data ?? []).map((row: any) => `collection ${row.handle}: ${row.title}`),
  ];
  if (catalogue.length === 0) {
    throw new Error(
      "There is no catalogue data to plan against yet. Run a catalogue sync before planning.",
    );
  }

  const covered = [
    ...(articles.data ?? []).map((row: any) => String(row.title)),
    ...(existingPlan.data ?? []).map((row: any) => String(row.title)),
  ];
  const seen = new Set(covered.map((title) => title.toLowerCase().trim()));

  const adapter = resolveAdapter();
  const completion = await adapter.complete({
    stage: "topic_discovery",
    promptVersionKey: "journal.monthly_plan",
    temperature: 0.7,
    maxOutputTokens: 4000,
    responseSchema: {},
    messages: [
      { role: "system", content: BRAND_RULES },
      {
        role: "user",
        content: [
          "Catalogue context (use the exact handles when suggesting related items):",
          catalogue.join("\n"),
          "",
          covered.length > 0
            ? `Already covered or already planned, do not repeat or paraphrase:\n${covered.join("\n")}`
            : "Nothing is covered yet.",
          "",
          `Plan ${wanted} distinct evergreen Journal topics for the month starting ${monthKey}.`,
          "Each topic must be genuinely useful to a shopper, commercially relevant to the catalogue and answerable without current news, prices or statistics.",
          "Vary the format across buying guides, comparisons, how to use, care and gifting ideas.",
          'Return JSON only: {"topics":[{"title":"","targetQuery":"","searchIntent":"","audience":"","angle":"","keywords":[""],"relatedHandles":[""]}]}',
        ].join("\n"),
      },
    ],
  });

  const parsed = completion.parsed as { topics?: PlannedTopic[] } | undefined;
  const topics = (parsed?.topics ?? []).filter((topic) => topic?.title?.trim());
  if (topics.length === 0) throw new Error("The planner returned no usable topics");

  const validHandles = new Set([
    ...(products.data ?? []).map((row: any) => String(row.handle)),
    ...(collections.data ?? []).map((row: any) => String(row.handle)),
  ]);

  const rows: Record<string, unknown>[] = [];
  let day = firstDay;
  for (const topic of topics) {
    const title = stripEmDashes(topic.title.trim());
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    if (day > daysInMonth) break;
    seen.add(key);
    rows.push({
      plan_month: monthKey,
      title,
      slug_hint: slugify(title),
      target_query: topic.targetQuery ?? null,
      search_intent: topic.searchIntent ?? null,
      audience: topic.audience ?? null,
      angle: topic.angle ? stripEmDashes(topic.angle) : null,
      keywords: stringArray(topic.keywords, 10),
      related_handles: stringArray(topic.relatedHandles, 8).filter((handle) =>
        validHandles.has(handle),
      ),
      planned_for: new Date(
        Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), day),
      )
        .toISOString()
        .slice(0, 10),
      status: "planned",
    });
    day += 1;
  }

  if (rows.length > 0) {
    const { error } = await supabase.from("editorial_plan_items").insert(rows as never);
    if (error) throw new Error(error.message);
  }

  await supabase.from("ai_generation_runs").insert({
    stage: "topic_discovery",
    status: "succeeded",
    entity_type: "editorial_plan",
    provider: completion.provider,
    model: completion.model,
    input: { month: monthKey, catalogueItems: catalogue.length },
    output: { planned: rows.map((row) => row["title"]) },
    used_live_research: false,
    token_input: completion.tokenInput ?? null,
    token_output: completion.tokenOutput ?? null,
    created_by: input.userId,
    completed_at: new Date().toISOString(),
  } as never);

  return { created: rows.length, month: monthKey, skipped: topics.length - rows.length };
}

/* ---------------------------- daily publisher ---------------------------- */

export interface DailyResult {
  status: "published" | "skipped" | "failed";
  message: string;
  articleId?: string;
  slug?: string;
  planItemId?: string;
}

interface DraftPayload {
  title?: string;
  slug?: string;
  excerpt?: string;
  body_markdown?: string;
  tags?: string[];
  keywords?: string[];
  meta_title?: string;
  meta_description?: string;
  hero_image_alt?: string;
  faqs?: { question?: string; answer?: string }[];
  internal_links?: {
    anchor_text?: string;
    target_type?: string;
    target_reference?: string;
    rationale?: string;
  }[];
}

const PLACEHOLDER_PATTERN = /(lorem ipsum|\bTODO\b|\bTBC\b|\{\{|\}\}|\[insert|placeholder text)/i;

/** Deterministic gate before anything reaches the public Journal. */
export function validateArticle(input: {
  title: string;
  slug: string;
  excerpt: string | null;
  body: string;
  metaTitle: string | null;
  metaDescription: string | null;
  heroImageUrl: string | null;
  faqs: { question: string; answer: string }[];
  links: { target_type: string; target_reference: string }[];
  knownHandles: Set<string>;
  knownArticleSlugs: Set<string>;
}): string[] {
  const problems: string[] = [];
  const body = input.body ?? "";

  if (body.trim().length < 2200) problems.push("the body is too short to be useful");
  if ((body.match(/^##\s+/gm) ?? []).length < 3) problems.push("fewer than three sections");
  if (/[—–]/.test(`${body} ${input.title} ${input.excerpt ?? ""}`)) {
    problems.push("banned dash characters are present");
  }
  if (PLACEHOLDER_PATTERN.test(body)) problems.push("unresolved placeholder text");
  if (/<\s*script|<\s*iframe|on\w+\s*=/i.test(body)) problems.push("unsafe markup in the body");
  if (!input.slug || !/^[a-z0-9-]+$/.test(input.slug)) problems.push("the slug is malformed");
  if (!input.excerpt || input.excerpt.trim().length < 40) problems.push("the excerpt is missing");
  if (!input.metaTitle || input.metaTitle.length > 65) problems.push("the meta title is unusable");
  if (!input.metaDescription || input.metaDescription.length > 170) {
    problems.push("the meta description is unusable");
  }
  if (!input.heroImageUrl) problems.push("no hero image was produced");

  for (const faq of input.faqs) {
    if (!faq.question?.trim() || !faq.answer?.trim()) {
      problems.push("an FAQ entry is incomplete");
      break;
    }
  }

  for (const link of input.links) {
    const reference = link.target_reference;
    const known =
      link.target_type === "article"
        ? input.knownArticleSlugs.has(reference)
        : input.knownHandles.has(reference);
    if (!known) {
      problems.push(`internal link target ${reference} does not exist`);
      break;
    }
  }

  // Unsupported current claims. Evergreen editorial should not date itself.
  if (/\b(this year|latest research|recent study|according to reports|as of 20\d\d)\b/i.test(body)) {
    problems.push("unsupported current or news style claims");
  }

  return problems;
}

/** Generates, checks and publishes the next planned article. */
export async function runDailyArticle(
  supabase: Db,
  input: { userId: string | null },
): Promise<DailyResult> {
  const today = new Date().toISOString().slice(0, 10);

  const { data: candidates, error: queueError } = await supabase
    .from("editorial_plan_items")
    .select("*")
    .eq("status", "planned")
    .lte("planned_for", today)
    .order("planned_for", { ascending: true })
    .limit(1);
  if (queueError) throw new Error(queueError.message);

  const item = (candidates ?? [])[0] as any;
  if (!item) {
    return {
      status: "skipped",
      message: "No planned topic is due today. The monthly plan run will add more.",
    };
  }

  // Claim the item so a duplicate invocation cannot pick up the same topic.
  const { data: claimed, error: claimError } = await supabase
    .from("editorial_plan_items")
    .update({ status: "generating", attempts: (item.attempts ?? 0) + 1 })
    .eq("id", item.id)
    .eq("status", "planned")
    .select("id")
    .maybeSingle();
  if (claimError) throw new Error(claimError.message);
  if (!claimed) {
    return { status: "skipped", message: "Another run already claimed today's topic." };
  }

  const fail = async (reason: string): Promise<DailyResult> => {
    await supabase
      .from("editorial_plan_items")
      .update({ status: "failed", failure_reason: reason })
      .eq("id", item.id);
    return { status: "failed", message: reason, planItemId: item.id };
  };

  try {
    const [products, collections, publishedArticles] = await Promise.all([
      supabase
        .from("shopify_products")
        .select("handle,title,product_type,tags")
        .limit(80),
      supabase.from("shopify_collections").select("handle,title").limit(40),
      supabase.from("articles").select("slug,title").limit(500),
    ]);

    const knownHandles = new Set<string>([
      ...(products.data ?? []).map((row: any) => String(row.handle)),
      ...(collections.data ?? []).map((row: any) => String(row.handle)),
    ]);
    const knownArticleSlugs = new Set<string>(
      (publishedArticles.data ?? []).map((row: any) => String(row.slug)),
    );
    const takenTitles = new Set(
      (publishedArticles.data ?? []).map((row: any) => String(row.title).toLowerCase().trim()),
    );

    if (takenTitles.has(String(item.title).toLowerCase().trim())) {
      return await fail("A published article already covers this topic.");
    }

    const adapter = resolveAdapter();
    const completion = await adapter.complete({
      stage: "draft",
      promptVersionKey: "journal.auto_article",
      temperature: 0.55,
      maxOutputTokens: 8000,
      responseSchema: {},
      messages: [
        { role: "system", content: BRAND_RULES },
        {
          role: "user",
          content: [
            "Write a complete Journal article for NUR GOODS.",
            `Planned title: ${item.title}`,
            item.angle ? `Angle: ${item.angle}` : "",
            item.audience ? `Audience: ${item.audience}` : "",
            item.target_query ? `Primary search query: ${item.target_query}` : "",
            item.search_intent ? `Search intent: ${item.search_intent}` : "",
            Array.isArray(item.keywords) && item.keywords.length > 0
              ? `Useful terms to cover naturally: ${item.keywords.join(", ")}`
              : "",
            "",
            "Catalogue you may link to, by exact handle:",
            [
              ...(products.data ?? []).map((row: any) => `product ${row.handle}: ${row.title}`),
              ...(collections.data ?? []).map(
                (row: any) => `collection ${row.handle}: ${row.title}`,
              ),
            ].join("\n"),
            "",
            "Requirements:",
            "- 900 to 1400 words of genuinely useful, specific, human editorial prose.",
            "- Markdown body using ## for sections and ### where helpful. No H1 in the body.",
            "- At least four sections, short readable paragraphs, and concise answerable openings under each heading.",
            "- Include an FAQ list only when the questions are genuinely useful, and make sure the body itself answers them.",
            "- Do not state prices, stock levels, specifications, ratings or delivery times.",
            "- Do not reference current events, dates, statistics or studies.",
            "- Internal links must use only the exact handles supplied above.",
            "",
            'Return JSON only: {"title":"","slug":"","excerpt":"","body_markdown":"","tags":[""],"keywords":[""],"meta_title":"","meta_description":"","hero_image_alt":"","faqs":[{"question":"","answer":""}],"internal_links":[{"anchor_text":"","target_type":"product|collection","target_reference":"","rationale":""}]}',
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    });

    const draft = (completion.parsed ?? {}) as DraftPayload;
    const title = stripEmDashes(String(draft.title ?? item.title).trim());
    let slug = slugify(draft.slug || item.slug_hint || title);
    if (knownArticleSlugs.has(slug)) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

    const body = stripEmDashes(String(draft.body_markdown ?? "").trim());
    const excerpt = stripEmDashes(String(draft.excerpt ?? "").trim()) || null;
    const metaTitle = stripEmDashes(String(draft.meta_title ?? title).trim()).slice(0, 65);
    const metaDescription = stripEmDashes(String(draft.meta_description ?? excerpt ?? "").trim());
    const faqs = (draft.faqs ?? [])
      .filter((faq) => faq?.question?.trim() && faq?.answer?.trim())
      .map((faq) => ({
        question: stripEmDashes(faq.question!.trim()),
        answer: stripEmDashes(faq.answer!.trim()),
      }))
      .slice(0, 6);
    const links = (draft.internal_links ?? [])
      .filter((link) => link?.anchor_text?.trim() && link?.target_reference?.trim())
      .map((link) => ({
        anchor_text: stripEmDashes(link.anchor_text!.trim()),
        target_type: ["product", "collection", "article"].includes(String(link.target_type))
          ? String(link.target_type)
          : "product",
        target_reference: String(link.target_reference).trim(),
        rationale: link.rationale ? stripEmDashes(link.rationale) : null,
      }))
      .filter((link) =>
        link.target_type === "article"
          ? knownArticleSlugs.has(link.target_reference)
          : knownHandles.has(link.target_reference),
      )
      .slice(0, 6);

    const { data: article, error: insertError } = await supabase
      .from("articles")
      .insert({
        title,
        slug,
        excerpt,
        body_markdown: body,
        meta_title: metaTitle,
        meta_description: metaDescription.slice(0, 170),
        canonical_url: `https://nurgoods.com/journal/${slug}`,
        schema_type: "BlogPosting",
        faqs: faqs as never,
        tags: stringArray(draft.tags, 8) as never,
        author_name: "NUR GOODS",
        reading_minutes: readingMinutes(body),
        status: "draft",
        stage: "draft",
        sources_verified: true,
        created_by: input.userId,
      } as never)
      .select("id,slug")
      .single();
    if (insertError || !article) {
      return await fail(insertError?.message ?? "The article record could not be created.");
    }

    const articleId = (article as any).id as string;

    if (links.length > 0) {
      await supabase.from("article_internal_links").insert(
        links.map((link) => ({
          article_id: articleId,
          anchor_text: link.anchor_text,
          target_type: link.target_type,
          target_reference: link.target_reference,
          rationale: link.rationale,
          accepted: true,
        })) as never,
      );
    }

    let heroUrl: string | null = null;
    try {
      const { generateArticleHeroImage } = await import("@/lib/ai/hero-image.server");
      const hero = await generateArticleHeroImage(supabase, {
        articleId,
        userId: input.userId ?? "",
      });
      heroUrl = hero.url;
    } catch {
      heroUrl = null;
    }

    const problems = validateArticle({
      title,
      slug: (article as any).slug,
      excerpt,
      body,
      metaTitle,
      metaDescription,
      heroImageUrl: heroUrl,
      faqs,
      links: links.map((link) => ({
        target_type: link.target_type,
        target_reference: link.target_reference,
      })),
      knownHandles,
      knownArticleSlugs,
    });

    if (problems.length > 0) {
      const reason = `Held back: ${problems.join("; ")}.`;
      await supabase
        .from("articles")
        .update({ status: "draft", stage: "approval" })
        .eq("id", articleId);
      await supabase
        .from("editorial_plan_items")
        .update({ status: "failed", failure_reason: reason, article_id: articleId })
        .eq("id", item.id);
      return { status: "failed", message: reason, articleId, planItemId: item.id };
    }

    const publishedAt = new Date().toISOString();
    const { error: publishError } = await supabase
      .from("articles")
      .update({ status: "published", stage: "scheduling", published_at: publishedAt })
      .eq("id", articleId);
    if (publishError) return await fail(publishError.message);

    await supabase
      .from("editorial_plan_items")
      .update({ status: "published", article_id: articleId, failure_reason: null })
      .eq("id", item.id);

    await supabase.from("ai_generation_runs").insert({
      stage: "draft",
      status: "succeeded",
      entity_type: "article",
      entity_id: articleId,
      provider: completion.provider,
      model: completion.model,
      input: { planItemId: item.id, title: item.title },
      output: { slug, links: links.length, faqs: faqs.length, hero: Boolean(heroUrl) },
      used_live_research: false,
      token_input: completion.tokenInput ?? null,
      token_output: completion.tokenOutput ?? null,
      created_by: input.userId,
      completed_at: publishedAt,
    } as never);

    return {
      status: "published",
      message: `Published "${title}".`,
      articleId,
      slug,
      planItemId: item.id,
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "The article run failed";
    return await fail(message);
  }
}
