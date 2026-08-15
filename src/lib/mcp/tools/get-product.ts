import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { getProduct } from "@/lib/public-api/queries.server";
import { textResult, errorResult } from "../result";

export default defineTool({
  name: "get_product",
  title: "Get a NUR GOODS product",
  description:
    "Retrieve one active NUR GOODS product by handle, including published benefits, use cases, specifications, delivery notes and questions.",
  inputSchema: { handle: z.string().trim().min(1).max(120).describe("Product handle.") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ handle }) => {
    const product = await getProduct(handle);
    if (!product) return errorResult("No public product matches that handle.");
    return textResult(JSON.stringify(product, null, 2), { product });
  },
});
