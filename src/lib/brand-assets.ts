/**
 * Central registry for the NUR GOODS logo artwork.
 *
 * ASSET STATUS: APPROVED MASTERS IN PLACE.
 * The four owner supplied master PNGs (square light, square dark, wordmark
 * light, wordmark dark) are stored unaltered and referenced below. They must
 * never be redrawn, recoloured or approximated. Every surface resolves its
 * logo through this module so a future master swap lands everywhere at once.
 *
 * Two complete sets exist: the light-surface set (navy NUR, gold star and
 * GOODS) and the dark-surface set (outlined NUR, gold star and GOODS). The
 * correct master file is always served directly. CSS filters are never used to
 * fake one from another.
 */
import squareLight from "@/assets/square-light-master.png.asset.json";
import squareDark from "@/assets/square-dark-master.png.asset.json";
import wordmarkLight from "@/assets/wordmark-light-master.png.asset.json";
import wordmarkDark from "@/assets/wordmark-dark-master.png.asset.json";

export type BrandSurface = "auto" | "light" | "dark";

/**
 * `horizontal` drives full-width headers and footers.
 * `compact` drives narrow headers and small chrome. It currently maps to the
 * square master because that treatment stays legible below ~140px of width.
 * `square` drives social, app and avatar placements.
 */
export type BrandTreatment = "horizontal" | "compact" | "square";

type MasterPair = { light: string; dark: string };

/** Approved masters are now in place. */
export const BRAND_ART_IS_FALLBACK = false;

export const BRAND_ART: Record<BrandTreatment, MasterPair> = {
  horizontal: { light: wordmarkLight.url, dark: wordmarkDark.url },
  compact: { light: squareLight.url, dark: squareDark.url },
  square: { light: squareLight.url, dark: squareDark.url },
};

/** Intrinsic aspect ratios, used to reserve space and avoid layout shift. */
export const BRAND_ART_RATIO: Record<BrandTreatment, number> = {
  horizontal: 2.5,
  compact: 1,
  square: 1,
};


/** Static brand mark used for favicon, PWA and app icon placements. */
export const BRAND_ICONS = {
  favicon: "/favicon.png",
  appleTouch: "/apple-touch-icon.png",
  icon192: "/icon-192.png",
  icon512: "/icon-512.png",
  maskable512: "/icon-maskable-512.png",
} as const;

export function brandArt(treatment: BrandTreatment, surface: Exclude<BrandSurface, "auto">) {
  return BRAND_ART[treatment][surface];
}
