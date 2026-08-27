import { createFileRoute } from "@tanstack/react-router";
import { BRAND } from "@/lib/brand";
import { canonical } from "@/lib/public-api/contract";
import { jsonOk, publicHandler } from "@/lib/public-api/http.server";
import { listPolicies } from "@/lib/public-api/queries.server";

/**
 * Brand and store knowledge an assistant can safely quote. Only owner supplied
 * brand facts and published policy documents appear here.
 */
export const Route = createFileRoute("/api/public/v1/store")({
  server: {
    handlers: {
      OPTIONS: publicHandler(async () => jsonOk({})),
      GET: publicHandler(async () => {
        const policies = await listPolicies();
        return jsonOk({
          data: {
            name: BRAND.name,
            tagline: BRAND.tagline,
            store_url: BRAND.storeUrl,
            site_url: BRAND.siteUrl,
            contact_url: `${BRAND.siteUrl}/contact`,
            social: { tiktok: { handle: BRAND.tiktokHandle, url: BRAND.tiktokUrl } },
            journal_url: canonical.journalIndex(),
            reviews_url: canonical.reviews(),
            policies,
            notes:
              policies.length === 0
                ? "No policy documents have been published yet. Direct shipping, returns and privacy questions through the contact form."
                : null,
          },
        });
      }),
    },
  },
});
