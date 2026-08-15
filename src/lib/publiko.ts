import type { PlacementSurface } from "@/lib/types/platform";

/**
 * Publiko is embed code based. The owner copies the widget code Publiko gives
 * them, names it, and assigns it to one of these placements. No provider API
 * key or direct API integration is needed for reviews to appear.
 */
export const PUBLIKO_PLACEMENTS: {
  surface: PlacementSurface;
  label: string;
  description: string;
}[] = [
  {
    surface: "footer",
    label: "Footer score or badge",
    description: "A compact score or badge shown in the footer of every public page.",
  },
  {
    surface: "homepage",
    label: "Homepage trust section",
    description: "A review or trust section on the homepage, below the range highlights.",
  },
  {
    surface: "product_page",
    label: "Product page review block",
    description: "A review block on every product page, below the product information.",
  },
  {
    surface: "reviews_page",
    label: "Reviews page Wall of Love",
    description: "The full review feed. This becomes the main content of the Reviews page.",
  },
  {
    surface: "article_page",
    label: "Journal article block",
    description: "A review block at the end of each Journal article.",
  },
  {
    surface: "collection_page",
    label: "Collection page block",
    description: "A review block on collection pages.",
  },
  {
    surface: "cart",
    label: "Cart reassurance",
    description: "Reserved for cart or checkout handoff reassurance.",
  },
  {
    surface: "custom",
    label: "Custom placement",
    description: "Stored and ready, but not rendered until a placement is chosen for it.",
  },
];

export const PUBLIKO_PLACEMENT_LABEL: Record<string, string> = Object.fromEntries(
  PUBLIKO_PLACEMENTS.map((item) => [item.surface, item.label]),
);

/** Turns an internal name into a stable, safe placement identifier. */
export function toPlacementKey(name: string, surface: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `publiko-${surface}-${base || Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Lists the external origins an embed loads scripts or frames from. Used by the
 * admin screen so the owner can see exactly which origins a widget needs, and
 * so any future content security policy can allow list those origins precisely
 * rather than opening script sources broadly.
 */
export function embedOrigins(html: string): string[] {
  const origins = new Set<string>();
  const matches = html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi);
  for (const match of matches) {
    const value = match[1];
    if (!value || !/^https?:\/\//i.test(value)) continue;
    try {
      origins.add(new URL(value).origin);
    } catch {
      // Ignore values that are not parseable URLs.
    }
  }
  return Array.from(origins).sort();
}

/** A very light structural check. It never strips provider markup. */
export function looksLikeEmbedCode(html: string): boolean {
  return /<[a-z]/i.test(html);
}
