/**
 * Local override layer for legal and policy documents imported from the store.
 *
 * The imported store copy is kept unchanged for audit and comparison. Anything
 * an admin edits here is stored separately, so a later store sync can refresh
 * the upstream wording without ever destroying local work. Pure helpers only,
 * safe to import from both server and browser code.
 */

export type LegalOverrideState =
  | "no_override"
  | "local_draft"
  | "override_active"
  | "upstream_changed";

/**
 * Stable, order independent fingerprint of the upstream wording. Used only to
 * detect that the store copy moved on since an override was published, never
 * for security.
 */
export function fingerprint(value: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = (Math.imul(h2 + code, 0x85ebca6b) ^ (h2 >>> 13)) >>> 0;
  }
  return `${h1.toString(16)}${h2.toString(16)}-${value.length.toString(16)}`;
}

export interface OverrideShape {
  draft_title: string;
  draft_summary: string | null;
  draft_body_html: string;
  published_title: string | null;
  published_body_html: string | null;
  published_summary: string | null;
  published_at: string | null;
  upstream_fingerprint: string | null;
  updated_at: string;
}

export function overrideState(
  override: OverrideShape | null | undefined,
  upstreamBody: string,
): LegalOverrideState {
  if (!override) return "no_override";
  if (!override.published_body_html) return "local_draft";
  if (override.upstream_fingerprint && override.upstream_fingerprint !== fingerprint(upstreamBody)) {
    return "upstream_changed";
  }
  return "override_active";
}

export function overrideStateLabel(state: LegalOverrideState): string {
  switch (state) {
    case "local_draft":
      return "Local draft";
    case "override_active":
      return "Local override active";
    case "upstream_changed":
      return "Upstream changed since override";
    default:
      return "Upstream current";
  }
}

export function overrideStateTone(
  state: LegalOverrideState,
): "positive" | "warning" | "neutral" {
  if (state === "override_active") return "positive";
  if (state === "upstream_changed" || state === "local_draft") return "warning";
  return "neutral";
}

/** A published override must actually contain readable wording. */
export function canPublishOverride(title: string, bodyHtml: string): boolean {
  const text = bodyHtml
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return title.trim().length > 2 && text.length >= 200;
}
