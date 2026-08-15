import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { searchProducts } from "@/lib/public-api/queries.server";
import { textResult } from "../result";

export default defineTool({
  name: "search_products",
  title: "Search NUR GOODS products",
  description:
    "Search active NUR GOODS products by keyword, product type or tag. Returns titles, pricing where synced, and canonical store links.",
  inputSchema: {
    query: z.string().trim().min(2).max(120).optional().describe("Free text search term."),
    product_type: z.string().trim().max(80).optional().describe("Exact product type filter."),
    tag: z.string().trim().max(80).optional().describe("Exact product tag filter."),
    limit: z.number().int().min(1).max(50).optional(),
    offset: z.number().int().min(0).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input) => {
    const result = await searchProducts({
      query: input.query,
      productType: input.product_type,
      tag: input.tag,
      limit: input.limit,
      offset: input.offset,
    });
    if (result.items.length === 0) {
      return textResult(
        "No published products match that search. The NUR GOODS catalogue may not be synced yet.",
        { items: [], page: result.page },
      );
    }
    return textResult(JSON.stringify(result.items, null, 2), result);
  },
});
