import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { getPolicy } from "@/lib/public-api/queries.server";
import { textResult, errorResult } from "../result";

export default defineTool({
  name: "get_policy",
  title: "Get a NUR GOODS policy",
  description:
    "Retrieve one published NUR GOODS policy document such as privacy, returns and refunds, or shipping and delivery.",
  inputSchema: { slug: z.string().trim().min(1).max(120).describe("Policy slug.") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ slug }) => {
    const policy = await getPolicy(slug);
    if (!policy) {
      return errorResult(
        "No published policy matches that slug. Do not infer policy wording that has not been published.",
      );
    }
    return textResult(JSON.stringify(policy, null, 2), { policy });
  },
});
