import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { searchCollections } from "@/lib/public-api/queries.server";
import { textResult } from "../result";

export default defineTool({
  name: "search_categories",
  title: "Search NUR GOODS categories",
  description: "List or search NUR GOODS store categories with canonical links and product counts.",
  inputSchema: {
    query: z.string().trim().min(2).max(120).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    offset: z.number().int().min(0).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input) => {
    const result = await searchCollections(input);
    if (result.items.length === 0) {
      return textResult(
        "No categories are available. The NUR GOODS catalogue may not be synced yet.",
        { items: [], page: result.page },
      );
    }
    return textResult(JSON.stringify(result.items, null, 2), result);
  },
});
