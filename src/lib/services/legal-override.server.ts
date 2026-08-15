/**
 * Server side helpers for the local legal override layer.
 *
 * The imported store row is never mutated here. Local edits live in their own
 * table and every change is written to a revision log so the owner can see who
 * changed what and when.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeStoreHtml } from "@/lib/legal/sanitize";

export type Client = SupabaseClient<any, "public", any>;

export const OVERRIDE_COLUMNS =
  "source_id, draft_title, draft_summary, draft_body_html, published_title, published_summary, published_body_html, published_at, upstream_fingerprint, updated_at, updated_by";

/** Removes anything outside the project allow list and strips store Liquid. */
export function cleanBody(html: string): string {
  const withoutLiquid = html
    .replace(/\{%[^%]{0,400}%\}/g, "")
    .replace(/\{\{[^}]{0,400}\}\}/g, "");
  return sanitizeStoreHtml(withoutLiquid).trim();
}

export function cleanText(value: string, max: number): string {
  return value.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

export async function loadSource(supabase: Client, sourceId: string) {
  const { data, error } = await supabase
    .from("shopify_legal_sources")
    .select("id, slug, title, body_html, body_summary")
    .eq("id", sourceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("That imported document no longer exists.");
  return data as {
    id: string;
    slug: string;
    title: string;
    body_html: string;
    body_summary: string | null;
  };
}

export async function recordRevision(
  supabase: Client,
  input: {
    sourceId: string;
    action: string;
    title?: string | null;
    summary?: string | null;
    bodyHtml?: string | null;
    upstreamFingerprint?: string | null;
    actor: string | null;
  },
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("legal_override_revisions").insert({
    source_id: input.sourceId,
    action: input.action,
    title: input.title ?? null,
    summary: input.summary ?? null,
    body_html: input.bodyHtml ?? null,
    upstream_fingerprint: input.upstreamFingerprint ?? null,
    actor: input.actor,
  });
}
