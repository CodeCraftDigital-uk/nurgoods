/**
 * Single source of truth for NUR GOODS brand facts used across public surfaces.
 * Only values supplied by the brand owner appear here. Nothing is invented.
 */
export const BRAND = {
  name: "NUR GOODS",
  tagline: "Good things, brought to light.",
  storeUrl: "https://NurGoods.com",
  siteUrl: "https://nurgoods.com",
  /**
   * Statutory business contact address. UK online selling rules require an
   * email contact in the trader information disclosure, so this value is
   * rendered on the legal contact information disclosure page only. Every
   * other public surface links to the contact form instead, which keeps the
   * address away from address harvesting bots.
   */
  supportEmail: "support@nurgoods.com",
  contactPath: "/contact",
  contactUrl: "https://nurgoods.com/contact",
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
