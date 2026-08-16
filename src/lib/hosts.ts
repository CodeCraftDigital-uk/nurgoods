/**
 * Hostname architecture for NUR GOODS.
 *
 * - nurgoods.com        public storefront and content
 * - shop.nurgoods.com   Shopify commerce and checkout (owned by the store)
 * - admin.nurgoods.com  the NUR GOODS platform admin console
 */
export const PUBLIC_HOST = "nurgoods.com";
export const ADMIN_HOST = "admin.nurgoods.com";
export const CHECKOUT_HOST = "shop.nurgoods.com";

/** Strip the port and normalise case so comparisons are stable. */
export function normaliseHost(host: string | null | undefined): string {
  if (!host) return "";
  return host.split(":")[0]!.trim().toLowerCase();
}

/** True when the request arrived on the canonical admin hostname. */
export function isAdminHost(host: string | null | undefined): boolean {
  return normaliseHost(host) === ADMIN_HOST;
}

/** True when the request arrived on the canonical public storefront hostname. */
export function isPublicProductionHost(host: string | null | undefined): boolean {
  const value = normaliseHost(host);
  return value === PUBLIC_HOST || value === `www.${PUBLIC_HOST}`;
}

/** Paths that belong to the admin console (including its sign in surface). */
export function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/") || pathname === "/auth";
}

/** Paths that must never be rewritten: APIs, assets and framework internals. */
export function isInfrastructurePath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_") ||
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/.well-known") ||
    pathname.startsWith("/.mcp") ||
    pathname === "/mcp" ||
    /\.[a-z0-9]+$/i.test(pathname)
  );
}
