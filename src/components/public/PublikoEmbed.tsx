import { useEffect, useRef } from "react";

/**
 * TRUST BOUNDARY
 * ---------------------------------------------------------------------------
 * This component renders raw embed markup supplied by the review provider and
 * saved by a signed in administrator. It is the only place in the application
 * where stored markup is injected into the page, and it must stay that way.
 *
 * Rules that keep this safe:
 *  - The markup can only be written by an administrator. Row level security on
 *    review_placements restricts every write to the admin role, so this is
 *    operator controlled configuration and never visitor supplied content.
 *  - Nothing here ever renders product, article, review or form input from a
 *    customer. Do not reuse this component for any other kind of content.
 *  - The markup is not sanitised, because provider widgets legitimately need
 *    their own script and iframe tags to work. Sanitising them away would
 *    silently break the widget instead of protecting anyone.
 *  - Scripts are deduplicated by source, so the same provider loader shared by
 *    several placements is only fetched and evaluated once per page.
 */

const loadedScriptSources = new Set<string>();

function executeScript(node: HTMLScriptElement, target: HTMLElement) {
  const src = node.getAttribute("src");
  if (src) {
    if (loadedScriptSources.has(src)) return;
    if (document.querySelector(`script[src="${CSS.escape(src)}"]`)) {
      loadedScriptSources.add(src);
      return;
    }
    loadedScriptSources.add(src);
  }

  const script = document.createElement("script");
  for (const attribute of Array.from(node.attributes)) {
    script.setAttribute(attribute.name, attribute.value);
  }
  if (!src) script.text = node.textContent ?? "";
  script.async = true;
  target.appendChild(script);
}

export function PublikoEmbed({ html, className }: { html: string; className?: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Markup first, then scripts, so provider loaders find their target nodes.
    const template = document.createElement("template");
    template.innerHTML = html;
    const scripts = Array.from(template.content.querySelectorAll("script"));
    for (const script of scripts) script.remove();

    container.replaceChildren(template.content.cloneNode(true));
    for (const script of scripts) executeScript(script, container);

    return () => {
      container.replaceChildren();
    };
  }, [html]);

  return <div ref={containerRef} className={className} />;
}
