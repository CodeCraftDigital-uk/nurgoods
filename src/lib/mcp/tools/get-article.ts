import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { getArticle } from "@/lib/public-api/queries.server";
import { textResult, errorResult } from "../result";

export default defineTool({
  name: "get_article",
  title: "Get a Journal article",
  description:
    "Retrieve one published NUR GOODS Journal article with its body, verified sources and questions.",
  inputSchema: { slug: z.string().trim().min(1).max(120).describe("Article slug.") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ slug }) => {
    const article = await getArticle(slug);
    if (!article) return errorResult("No published article matches that slug.");
    return textResult(JSON.stringify(article, null, 2), { article });
  },
});
