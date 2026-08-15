import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { listAnswers } from "@/lib/public-api/queries.server";
import { textResult } from "../result";

export default defineTool({
  name: "get_answers",
  title: "Get approved answers",
  description:
    "Approved question and answer pairs attached to public NUR GOODS products, categories and Journal articles.",
  inputSchema: {
    query: z.string().trim().min(2).max(120).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    offset: z.number().int().min(0).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input) => {
    const result = await listAnswers(input);
    if (result.items.length === 0) {
      return textResult("No approved answers match that search.", { items: [], page: result.page });
    }
    return textResult(JSON.stringify(result.items, null, 2), result);
  },
});
