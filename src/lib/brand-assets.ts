/**
 * Central registry for the NUR GOODS logo artwork.
 *
 * ASSET STATUS: TEMPORARY FALLBACK.
 * The four owner approved master PNGs (square light, square dark, wordmark
 * light, wordmark dark) have not yet been delivered into this repository. The
 * files referenced below are the earlier artwork and are in place only so that
 * every surface keeps rendering. They must not be treated as final brand
 * masters, and they must never be redrawn or approximated. When the approved
 * masters arrive, drop them in and repoint the four imports below. Nothing
 * else needs to change, because every surface resolves through this module.
 *
 * Every surface resolves its logo through this module so that when a master
 * variant is replaced the change lands everywhere at once. Two complete sets
 * exist: the light-surface set (navy NUR, gold star and GOODS) and the
 * dark-surface set (white NUR, gold star and GOODS). The correct master file is
 * always served directly. CSS filters are never used to fake one from another.
 */
import squareLight from "@/assets/square-light.png.asset.json";
import squareDark from "@/assets/square-dark.png.asset.json";
import wordmarkLight from "@/assets/wordmark-light.png.asset.json";
import wordmarkDark from "@/assets/wordmark-dark.png.asset.json";

export type BrandSurface = "auto" | "light" | "dark";

/**
 * `horizontal` drives full-width headers and footers.
 * `compact` drives narrow headers and small chrome. It currently maps to the
 * square master because that treatment stays legible below ~140px of width.
 * `square` drives social, app and avatar placements.
 */
export type BrandTreatment = "horizontal" | "compact" | "square";

type MasterPair = { light: string; dark: string };

/** True until the owner approved master PNGs replace the fallback artwork. */
export const BRAND_ART_IS_FALLBACK = true;

export const BRAND_ART: Record<BrandTreatment, MasterPair> = {
  horizontal: { light: wordmarkLight.url, dark: wordmarkDark.url },
  compact: { light: squareLight.url, dark: squareDark.url },
  square: { light: squareLight.url, dark: squareDark.url },
};

/** Intrinsic aspect ratios, used to reserve space and avoid layout shift. */
export const BRAND_ART_RATIO: Record<BrandTreatment, number> = {
  horizontal: 3.6,
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
