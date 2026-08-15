/**
 * Conservative HTML allow list for content mirrored from the connected store.
 *
 * Trust boundary: the body arrives from the owner's own store over an
 * authenticated Admin API call, so it is trusted authorship, but it is still
 * third party markup rendered inside our pages. Everything outside the allow
 * list below is removed before the markup is handed to the renderer, including
 * scripts, styles, frames, embedded objects, event handler attributes and any
 * non http, mailto or relative URL.
 */

const ALLOWED_TAGS = new Set([
  "p",
  "br",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "small",
  "sup",
  "sub",
  "blockquote",
  "a",
  "span",
  "div",
  "section",
  "article",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "caption",
  "dl",
  "dt",
  "dd",
  "figure",
  "figcaption",
  "address",
  "pre",
  "code",
]);

const DROP_WITH_CONTENT = ["script", "style", "iframe", "object", "embed", "template", "noscript"];

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(["href", "title", "target", "rel"]),
  th: new Set(["colspan", "rowspan", "scope"]),
  td: new Set(["colspan", "rowspan"]),
};

function safeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (/^(https?:|mailto:|tel:|\/|#)/i.test(trimmed)) return trimmed;
  return null;
}

function cleanAttributes(tag: string, raw: string): string {
  const allowed = ALLOWED_ATTRS[tag];
  if (!allowed) return "";
  const out: string[] = [];
  const pattern = /([a-zA-Z:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) !== null) {
    const name = match[1]!.toLowerCase();
    if (!allowed.has(name)) continue;
    const value = match[3] ?? match[4] ?? match[5] ?? "";
    if (name === "href") {
      const url = safeUrl(value);
      if (!url) continue;
      out.push(`href="${escapeAttr(url)}"`);
      continue;
    }
    if (name === "target") {
      out.push(`target="_blank"`);
      continue;
    }
    out.push(`${name}="${escapeAttr(value)}"`);
  }
  if (tag === "a" && out.some((attr) => attr.startsWith("target="))) {
    if (!out.some((attr) => attr.startsWith("rel="))) out.push(`rel="noopener noreferrer"`);
  }
  return out.length > 0 ? ` ${out.join(" ")}` : "";
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** Returns markup limited to the allow list above. */
export function sanitizeStoreHtml(input: string): string {
  let html = input ?? "";

  for (const tag of DROP_WITH_CONTENT) {
    html = html.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), "");
    html = html.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi"), "");
  }
  html = html.replace(/<!--[\s\S]*?-->/g, "");

  return html.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (_full, rawTag: string, attrs: string) => {
    const tag = rawTag.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return "";
    const closing = _full.startsWith("</");
    if (closing) return `</${tag}>`;
    const selfClosing = tag === "br" || tag === "hr";
    return `<${tag}${cleanAttributes(tag, attrs)}${selfClosing ? " /" : ""}>`;
  });
}
