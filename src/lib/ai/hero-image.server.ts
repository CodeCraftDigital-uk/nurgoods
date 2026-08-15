import type { SupabaseClient } from "@supabase/supabase-js";
import { readManagedAiKey } from "./gateway.server";

/**
 * Hero image production for Journal articles.
 *
 * A branded editorial image is generated for the article, stored in the
 * private media bucket and served back through the public media route so the
 * page, the Journal index and the social preview tags all share one stable
 * absolute URL. When generation is unavailable the article falls back to
 * genuine catalogue photography from a linked product or collection.
 */

const IMAGE_MODEL = "google/gemini-3.1-flash-image";
const SITE_ORIGIN = "https://nurgoods.com";
const BUCKET = "journal-media";

export interface HeroImageResult {
  source: "generated" | "catalogue";
  url: string;
  alt: string;
}

function buildPrompt(title: string, excerpt: string | null, tags: string[]): string {
  const themes = tags.slice(0, 5).join(", ");
  return [
    "A premium editorial hero image for a retail brand journal article.",
    `Article title: ${title}.`,
    excerpt ? `Article summary: ${excerpt}.` : "",
    themes ? `Themes: ${themes}.` : "",
    "Style: calm, modern, minimal still life photography with generous negative space,",
    "soft directional daylight, deep navy and warm gold accents against a clean off white surface,",
    "shallow depth of field, wide 1200 by 630 landscape composition.",
    "No text, no words, no letters, no logos, no watermarks, no people looking at camera.",
  ]
    .filter(Boolean)
    .join(" ");
}

async function generateImageBytes(prompt: string): Promise<Uint8Array | null> {
  const apiKey = readManagedAiKey();
  if (!apiKey) return null;

  const response = await fetch("https://ai.gateway.lovable.dev/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      messages: [{ role: "user", content: prompt }],
      modalities: ["image", "text"],
    }),
  });

  if (!response.ok) return null;
  const payload = (await response.json()) as { data?: Array<{ b64_json?: string }> };
  const b64 = payload.data?.[0]?.b64_json;
  if (!b64) return null;

  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Genuine catalogue photography linked to the article, used when generation is unavailable. */
async function resolveCatalogueImage(
  supabase: SupabaseClient<any, "public", any>,
  articleId: string,
  tags: string[],
): Promise<{ url: string; alt: string } | null> {
  const { data: links } = await supabase
    .from("article_internal_links")
    .select("target_type,target_reference")
    .eq("article_id", articleId);

  for (const link of links ?? []) {
    if (!link.target_reference) continue;
    if (link.target_type === "product") {
      const { data: product } = await supabase
        .from("shopify_products")
        .select("title,featured_image_url")
        .eq("handle", link.target_reference)
        .maybeSingle();
      if (product?.featured_image_url) {
        return { url: product.featured_image_url, alt: product.title };
      }
    }
    if (link.target_type === "collection") {
      const { data: collection } = await supabase
        .from("shopify_collections")
        .select("title,image_url")
        .eq("handle", link.target_reference)
        .maybeSingle();
      if (collection?.image_url) {
        return { url: collection.image_url, alt: collection.title };
      }
    }
  }

  if (tags.length > 0) {
    const { data: tagged } = await supabase
      .from("shopify_products")
      .select("title,featured_image_url,tags")
      .overlaps("tags", tags)
      .not("featured_image_url", "is", null)
      .limit(1);
    const match = tagged?.[0];
    if (match?.featured_image_url) {
      return { url: match.featured_image_url, alt: match.title };
    }
  }

  const { data: any } = await supabase
    .from("shopify_products")
    .select("title,featured_image_url")
    .not("featured_image_url", "is", null)
    .limit(1);
  const fallback = any?.[0];
  if (fallback?.featured_image_url) {
    return { url: fallback.featured_image_url, alt: fallback.title };
  }
  return null;
}

export async function generateArticleHeroImage(
  supabase: SupabaseClient<any, "public", any>,
  input: { articleId: string; userId: string },
): Promise<HeroImageResult> {
  const { data: article, error } = await supabase
    .from("articles")
    .select("id,slug,title,excerpt,tags")
    .eq("id", input.articleId)
    .single();
  if (error || !article) throw new Error("Article not found");

  const tags = Array.isArray(article.tags) ? (article.tags as string[]) : [];
  const alt = `Editorial image for ${article.title}`;

  let result: HeroImageResult | null = null;

  try {
    const bytes = await generateImageBytes(buildPrompt(article.title, article.excerpt, tags));
    if (bytes) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const path = `articles/${article.slug}-${Date.now()}.png`;
      const { error: uploadError } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: "image/png", upsert: true });
      if (!uploadError) {
        result = {
          source: "generated",
          url: `${SITE_ORIGIN}/api/public/journal-media/${path}`,
          alt,
        };
      }
    }
  } catch {
    result = null;
  }

  if (!result) {
    const catalogue = await resolveCatalogueImage(supabase, input.articleId, tags);
    if (!catalogue) {
      throw new Error(
        "No hero image could be produced and no catalogue image is available to fall back on.",
      );
    }
    result = { source: "catalogue", url: catalogue.url, alt: catalogue.alt };
  }

  const { error: updateError } = await supabase
    .from("articles")
    .update({ hero_image_url: result.url, hero_image_alt: result.alt })
    .eq("id", input.articleId);
  if (updateError) throw new Error(updateError.message);

  return result;
}
