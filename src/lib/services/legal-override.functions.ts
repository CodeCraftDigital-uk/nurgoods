import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  OVERRIDE_COLUMNS,
  cleanBody,
  cleanText,
  loadSource,
  recordRevision,
  type Client,
} from "./legal-override.server";
import { fingerprint } from "@/lib/legal/override";
import type { OverrideShape } from "@/lib/legal/override";

export interface LegalOverrideRow extends OverrideShape {
  source_id: string;
  updated_by: string | null;
}

export const listLegalOverrides = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LegalOverrideRow[]> => {
    const supabase = context.supabase as unknown as Client;
    const { data, error } = await supabase
      .from("legal_source_overrides")
      .select(OVERRIDE_COLUMNS);
    if (error) throw new Error(error.message);
    return (data ?? []) as LegalOverrideRow[];
  });

export const listLegalOverrideRevisions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { sourceId: string }) => ({ sourceId: String(input.sourceId) }))
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as unknown as Client;
    const { data: rows, error } = await supabase
      .from("legal_override_revisions")
      .select("id, action, title, created_at")
      .eq("source_id", data.sourceId)
      .order("created_at", { ascending: false })
      .limit(12);
    if (error) throw new Error(error.message);
    return (rows ?? []) as { id: string; action: string; title: string | null; created_at: string }[];
  });

export const saveLegalOverrideDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    sourceId: string;
    title: string;
    summary: string;
    bodyHtml: string;
  }) => ({
    sourceId: String(input.sourceId),
    title: String(input.title ?? "").slice(0, 300),
    summary: String(input.summary ?? "").slice(0, 600),
    bodyHtml: String(input.bodyHtml ?? "").slice(0, 200_000),
  }))
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as unknown as Client;
    const source = await loadSource(supabase, data.sourceId);
    const title = cleanText(data.title, 300) || source.title;
    const summary = cleanText(data.summary, 600);
    const body = cleanBody(data.bodyHtml);

    const { error } = await supabase.from("legal_source_overrides").upsert(
      {
        source_id: data.sourceId,
        draft_title: title,
        draft_summary: summary || null,
        draft_body_html: body,
        updated_by: context.userId,
      },
      { onConflict: "source_id" },
    );
    if (error) throw new Error(error.message);

    await recordRevision(supabase, {
      sourceId: data.sourceId,
      action: "save_draft",
      title,
      summary: summary || null,
      bodyHtml: body,
      actor: context.userId,
    });
    return { ok: true, title, summary, bodyHtml: body };
  });

export const publishLegalOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { sourceId: string }) => ({ sourceId: String(input.sourceId) }))
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as unknown as Client;
    const source = await loadSource(supabase, data.sourceId);
    const { data: existing, error: readError } = await supabase
      .from("legal_source_overrides")
      .select(OVERRIDE_COLUMNS)
      .eq("source_id", data.sourceId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!existing) throw new Error("Save a local draft before publishing it.");

    const { canPublishOverride } = await import("@/lib/legal/override");
    if (!canPublishOverride(existing.draft_title, existing.draft_body_html)) {
      throw new Error("The local copy needs a title and enough wording before it can be published.");
    }

    const mark = fingerprint(source.body_html ?? "");
    const { error } = await supabase
      .from("legal_source_overrides")
      .update({
        published_title: existing.draft_title,
        published_summary: existing.draft_summary,
        published_body_html: existing.draft_body_html,
        published_at: new Date().toISOString(),
        upstream_fingerprint: mark,
        updated_by: context.userId,
      })
      .eq("source_id", data.sourceId);
    if (error) throw new Error(error.message);

    await recordRevision(supabase, {
      sourceId: data.sourceId,
      action: "publish",
      title: existing.draft_title,
      bodyHtml: existing.draft_body_html,
      upstreamFingerprint: mark,
      actor: context.userId,
    });
    return { ok: true };
  });

/** Removes the local copy entirely so the imported store wording applies again. */
export const revertLegalOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { sourceId: string }) => ({ sourceId: String(input.sourceId) }))
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as unknown as Client;
    const { error } = await supabase
      .from("legal_source_overrides")
      .delete()
      .eq("source_id", data.sourceId);
    if (error) throw new Error(error.message);
    await recordRevision(supabase, {
      sourceId: data.sourceId,
      action: "revert_to_source",
      actor: context.userId,
    });
    return { ok: true };
  });

/** Throws away unpublished edits and leaves any published local copy in place. */
export const discardLegalDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { sourceId: string }) => ({ sourceId: String(input.sourceId) }))
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as unknown as Client;
    const { data: existing, error: readError } = await supabase
      .from("legal_source_overrides")
      .select(OVERRIDE_COLUMNS)
      .eq("source_id", data.sourceId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!existing) return { ok: true };

    if (!existing.published_body_html) {
      const { error } = await supabase
        .from("legal_source_overrides")
        .delete()
        .eq("source_id", data.sourceId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase
        .from("legal_source_overrides")
        .update({
          draft_title: existing.published_title,
          draft_summary: existing.published_summary,
          draft_body_html: existing.published_body_html,
          updated_by: context.userId,
        })
        .eq("source_id", data.sourceId);
      if (error) throw new Error(error.message);
    }
    await recordRevision(supabase, {
      sourceId: data.sourceId,
      action: "discard_draft",
      actor: context.userId,
    });
    return { ok: true };
  });

/** Marks the current upstream wording as reviewed without changing the local copy. */
export const acknowledgeUpstreamChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { sourceId: string }) => ({ sourceId: String(input.sourceId) }))
  .handler(async ({ context, data }) => {
    const supabase = context.supabase as unknown as Client;
    const source = await loadSource(supabase, data.sourceId);
    const mark = fingerprint(source.body_html ?? "");
    const { error } = await supabase
      .from("legal_source_overrides")
      .update({ upstream_fingerprint: mark, updated_by: context.userId })
      .eq("source_id", data.sourceId);
    if (error) throw new Error(error.message);
    await recordRevision(supabase, {
      sourceId: data.sourceId,
      action: "acknowledge_upstream",
      upstreamFingerprint: mark,
      actor: context.userId,
    });
    return { ok: true };
  });
