import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { searchArticles } from "@/lib/public-api/queries.server";
import { textResult } from "../result";

export default defineTool({
  name: "search_articles",
  title: "Search the NUR GOODS Journal",
  description:
    "Search published NUR GOODS Journal articles by keyword or tag. Only human approved, published articles are returned.",
  inputSchema: {
    query: z.string().trim().min(2).max(120).optional(),
    tag: z.string().trim().max(80).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    offset: z.number().int().min(0).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input) => {
    const result = await searchArticles(input);
    if (result.items.length === 0) {
      return textResult("No published Journal articles match that search.", {
        items: [],
        page: result.page,
      });
    }
    return textResult(JSON.stringify(result.items, null, 2), result);
  },
});
