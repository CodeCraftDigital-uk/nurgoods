/**
 * Single source of truth for NUR GOODS brand facts used across public surfaces.
 * Only values supplied by the brand owner appear here. Nothing is invented.
 */
export const BRAND = {
  name: "NUR GOODS",
  tagline: "Good things, brought to light.",
  storeUrl: "https://NurGoods.com",
  siteUrl: "https://nurgoods.com",
  supportEmail: "support@nurgoods.com",
  tiktokHandle: "@nur.goods",
  tiktokUrl: "https://www.tiktok.com/@nur.goods",
} as const;

export const LEGAL_NAV_ORDER = [
  "privacy",
  "cookies",
  "terms",
  "returns_refunds",
  "shipping_delivery",
  "contact",
  "about",
  "accessibility",
] as const;
