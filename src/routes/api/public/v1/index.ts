import { createFileRoute } from "@tanstack/react-router";
import { BRAND } from "@/lib/brand";
import {
  CONNECTOR_RESOURCES,
  PAGE_LIMITS,
  PUBLIC_API_BASE,
  PUBLIC_API_VERSION,
} from "@/lib/public-api/contract";
import { jsonOk, publicHandler } from "@/lib/public-api/http.server";
import { connectorDataCounts } from "@/lib/public-api/queries.server";

/**
 * Discovery document for the public NUR GOODS knowledge API. Describes the
 * contract only. It never lists admin routes and never reports credentials.
 */
export const Route = createFileRoute("/api/public/v1/")({
  server: {
    handlers: {
      OPTIONS: publicHandler(async () => jsonOk({})),
      GET: publicHandler(async () => {
        let counts: Awaited<ReturnType<typeof connectorDataCounts>> | null = null;
        try {
          counts = await connectorDataCounts();
        } catch {
          counts = null;
        }

        return jsonOk({
          name: `${BRAND.name} public knowledge API`,
          description:
            "Read only access to public product, category, Journal and store policy knowledge for NUR GOODS. No customer, order, account or administrative data is available through this surface.",
          version: PUBLIC_API_VERSION,
          base_path: PUBLIC_API_BASE,
          brand: {
            name: BRAND.name,
            tagline: BRAND.tagline,
            store_url: BRAND.storeUrl,
            site_url: BRAND.siteUrl,
            support_email: BRAND.supportEmail,
          },
          access: {
            authentication: "none",
            scope: "read_only",
            rate_limit: "60 requests per minute per caller, best effort",
            pagination: { default_limit: PAGE_LIMITS.default, max_limit: PAGE_LIMITS.max },
          },
          resources: CONNECTOR_RESOURCES.map((resource) => ({
            key: resource.key,
            label: resource.label,
            description: resource.description,
            path: resource.httpPath,
            available: resource.requiresStoreSync ? (counts?.products ?? 0) > 0 : true,
            unavailable_reason:
              resource.requiresStoreSync && (counts?.products ?? 0) === 0
                ? "The store catalogue has not been synced yet, so no records are published on this resource."
                : undefined,
          })),
          content_counts: counts,
        });
      }),
    },
  },
});
