import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface ConnectorReadiness {
  version: string;
  connectorPath: string;
  apiBasePath: string;
  counts: {
    products: number;
    collections: number;
    articles: number;
    policies: number;
    answers: number;
    lastStoreSyncAt: string | null;
  };
  resources: {
    key: string;
    label: string;
    description: string;
    httpPath: string;
    backingTables: string[];
    ready: boolean;
    blockedReason: string | null;
  }[];
}

/**
 * Genuine readiness of the public connector surface, counted from the same
 * public reads the connector itself performs. Admin only because it is shown
 * inside the control plane, though it exposes no private values.
 */
export const getConnectorReadiness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<ConnectorReadiness> => {
    const { CONNECTOR_RESOURCES, PUBLIC_API_BASE, PUBLIC_API_VERSION } = await import(
      "@/lib/public-api/contract"
    );
    const { connectorDataCounts } = await import("@/lib/public-api/queries.server");
    const counts = await connectorDataCounts();

    const resources = CONNECTOR_RESOURCES.map((resource) => {
      let ready = true;
      let blockedReason: string | null = null;

      if (resource.requiresStoreSync && counts.products === 0) {
        ready = false;
        blockedReason =
          "The store catalogue has not been synced yet, so this resource returns nothing.";
      }
      if (resource.key === "search_articles" || resource.key === "get_article") {
        if (counts.articles === 0) {
          ready = false;
          blockedReason = "No Journal article has been published and approved yet.";
        }
      }
      if (resource.key === "get_policy" && counts.policies === 0) {
        ready = false;
        blockedReason = "No policy document has been published yet.";
      }
      if (resource.key === "get_answers" && counts.answers === 0) {
        ready = false;
        blockedReason = "No answerable question has been approved for public use yet.";
      }

      return {
        key: resource.key,
        label: resource.label,
        description: resource.description,
        httpPath: resource.httpPath,
        backingTables: resource.backingTables,
        ready,
        blockedReason,
      };
    });

    return {
      version: PUBLIC_API_VERSION,
      connectorPath: "/mcp",
      apiBasePath: PUBLIC_API_BASE,
      counts,
      resources,
    };
  });
