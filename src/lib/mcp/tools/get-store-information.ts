import { defineTool } from "@lovable.dev/mcp-js";
import { BRAND } from "@/lib/brand";
import { canonical } from "@/lib/public-api/contract";
import { listPolicies } from "@/lib/public-api/queries.server";
import { textResult } from "../result";

export default defineTool({
  name: "get_store_information",
  title: "Get NUR GOODS store information",
  description:
    "Brand facts, support contact, social presence and the list of published NUR GOODS policies including shipping and returns where published.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async () => {
    const policies = await listPolicies();
    const payload = {
      name: BRAND.name,
      tagline: BRAND.tagline,
      store_url: BRAND.storeUrl,
      site_url: BRAND.siteUrl,
      support_email: BRAND.supportEmail,
      tiktok: BRAND.tiktokUrl,
      journal_url: canonical.journalIndex(),
      reviews_url: canonical.reviews(),
      policies,
      notes:
        policies.length === 0
          ? "No policy documents have been published yet. Send shipping, returns and privacy questions to the support email rather than stating a policy."
          : null,
    };
    return textResult(JSON.stringify(payload, null, 2), payload);
  },
});
