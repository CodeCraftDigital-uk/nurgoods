import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { connectorSearchProducts } from "@/lib/public-api/connector.server";
import { textResult } from "../result";

export default defineTool({
  name: "search_products",
  title: "Search NUR GOODS products",
  description:
    "Search the published NUR GOODS catalogue by keyword, category, product type or tag. Returns titles, short summaries, images, current customer facing GBP prices, availability and product page links. Read only.",
  inputSchema: {
    query: z.string().trim().min(2).max(120).optional().describe("Free text search term."),
    category: z.string().trim().max(80).optional().describe("Category slug or name filter."),
    product_type: z.string().trim().max(80).optional().describe("Exact product type filter."),
    tag: z.string().trim().max(80).optional().describe("Exact product tag filter."),
    limit: z.number().int().min(1).max(50).optional(),
    offset: z.number().int().min(0).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input) => {
    const result = await connectorSearchProducts({
      query: input.query,
      category: input.category,
      product_type: input.product_type,
      tag: input.tag,
      limit: input.limit,
      offset: input.offset,
    });
    if (result.items.length === 0) {
      return textResult(
        "No published NUR GOODS products match that search. Try a broader term or a different category.",
        { items: [], page: result.page },
      );
    }
    return textResult(JSON.stringify(result.items, null, 2), result);
  },
});
