import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { connectorGetProduct } from "@/lib/public-api/connector.server";
import { textResult, errorResult } from "../result";

export default defineTool({
  name: "get_product",
  title: "Get a NUR GOODS product",
  description:
    "Retrieve one published NUR GOODS product by handle. Returns the shopper facing description, images, categories, availability, the active variants with their options and current GBP prices, and the product page link. Read only.",
  inputSchema: {
    handle: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe("Product handle, as returned by search_products."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ handle }) => {
    const product = await connectorGetProduct(handle);
    if (!product) {
      return errorResult(
        "No published NUR GOODS product matches that handle. It may be unavailable or no longer listed.",
      );
    }
    return textResult(JSON.stringify(product, null, 2), { product });
  },
});
