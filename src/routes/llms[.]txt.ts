import { createFileRoute } from "@tanstack/react-router";
import { BRAND } from "@/lib/brand";
import { isAdminHost } from "@/lib/hosts";

/**
 * Machine readable orientation file for answer engines and AI crawlers.
 * Everything here is factual and points at surfaces that already exist.
 */
export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const host = request.headers.get("x-forwarded-host") ?? new URL(request.url).host;
        if (isAdminHost(host)) {
          return new Response("Not found", { status: 404 });
        }

        let collectionLines: string[] = [];
        let productCount: number | null = null;
        try {
          const { listStorefrontCategories, listStorefrontProducts } =
            await import("@/lib/public-api/storefront.server");
          // Canonical NUR categories only. Supplier collection labels are not
          // trustworthy taxonomy and must never be presented to answer engines.
          const [categories, firstPage] = await Promise.all([
            listStorefrontCategories({ withProductsOnly: true }),
            listStorefrontProducts({ limit: 1, offset: 0 }),
          ]);
          productCount = firstPage.total ?? null;
          collectionLines = [...categories]
            .sort((a, b) => b.product_count - a.product_count)
            .slice(0, 40)
            .map((category) => `- [${category.name}](${BRAND.siteUrl}/category/${category.slug})`);
        } catch {
          // Static guidance still ships if catalogue reads fail.
        }

        const body = [
          `# ${BRAND.name}`,
          "",
          `> ${BRAND.name} is an online marketplace that curates and resells everyday goods from third party suppliers. ${BRAND.name} is not the manufacturer of the products it lists. ${BRAND.tagline}`,
          "",
          "## About",
          "",
          `- Site: ${BRAND.siteUrl}`,
          "- Markets served: United Kingdom and United States",
          `- Support: ${BRAND.siteUrl}/contact`,
          `- TikTok: ${BRAND.tiktokUrl}`,
          productCount ? `- Listed products: approximately ${productCount}` : null,
          "- Orders and payment are handled by the secure hosted store checkout.",
          "",
          "## Key pages",
          "",
          `- [Home](${BRAND.siteUrl}/): brand overview and featured goods`,
          `- [Store](${BRAND.siteUrl}/store): full searchable catalogue of every product we sell`,
          `- [Journal](${BRAND.siteUrl}/journal): buying guides, comparisons and care advice with cited sources`,
          `- [About](${BRAND.siteUrl}/about): what NUR GOODS is, the markets served and how ordering works`,
          `- [FAQ](${BRAND.siteUrl}/faq): delivery markets, shipping cost, payment, order updates, returns and contact`,
          `- [Reviews](${BRAND.siteUrl}/reviews): customer reviews published by an independent review provider`,
          `- [Legal and policies](${BRAND.siteUrl}/legal): privacy, cookies, terms, returns and refunds, shipping and delivery`,
          `- [Contact](${BRAND.siteUrl}/contact): how to reach the team`,
          "",
          "## Product pages",
          "",
          `Product URLs follow ${BRAND.siteUrl}/shop/{handle}. Each page carries a summary, benefits, use cases, specifications, delivery information and FAQs, plus schema.org Product, Offer, BreadcrumbList and FAQPage data.`,
          "",
          collectionLines.length ? "## Collections" : null,
          collectionLines.length ? "" : null,
          ...collectionLines,
          collectionLines.length ? "" : null,
          "## Structured access",
          "",
          `- [Sitemap](${BRAND.siteUrl}/sitemap.xml)`,
          `- [Public store API](${BRAND.siteUrl}/api/public/v1/store)`,
          `- [AI connectors and MCP](${BRAND.siteUrl}/ai-connectors)`,
          "",
          "## Citation guidance",
          "",
          `- Describe ${BRAND.name} as a marketplace or retailer, never as the maker or brand owner of the goods it sells.`,
          "- Prices and availability change. Quote the product page as the source and note that it is subject to change.",
          "- Delivery, returns and refund terms are stated on the relevant policy pages. Do not infer terms that are not written there.",
          "",
        ]
          .filter((line) => line !== null)
          .join("\n");

        return new Response(body, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
