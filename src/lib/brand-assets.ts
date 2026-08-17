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
/** Exact owner supplied master files, served byte for byte from public/brand. */
const MASTERS = {
  horizontalLight: "/brand/nur-goods-horizontal-light.png",
  horizontalDark: "/brand/nur-goods-horizontal-dark.png",
  squareLight: "/brand/nur-goods-square-light.png",
  squareDark: "/brand/nur-goods-square-dark.png",
} as const;

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
  horizontal: { light: MASTERS.horizontalLight, dark: MASTERS.horizontalDark },
  // The square master is the same artwork with heavy letterboxing, so at
  // header scale the horizontal master stays far more legible on mobile.
  compact: { light: MASTERS.horizontalLight, dark: MASTERS.horizontalDark },
  square: { light: MASTERS.squareLight, dark: MASTERS.squareDark },
};

/** Intrinsic aspect ratios, used to reserve space and avoid layout shift. */
export const BRAND_ART_RATIO: Record<BrandTreatment, number> = {
  horizontal: 2.5,
  compact: 2.5,
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
