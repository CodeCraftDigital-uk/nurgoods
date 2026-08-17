/**
 * Central registry for the official NUR GOODS master artwork.
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
