import { createFileRoute } from "@tanstack/react-router";
import { BRAND } from "@/lib/brand";

/** Sitemap for the content surfaces this platform owns. Commerce URLs stay with the store. */
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const { listPublicArticles, listPublicLegalDocuments, listPublicLegalSources } = await import(
          "@/lib/services/public-content.functions"
        );

        const entries: { loc: string; lastmod?: string | undefined; priority: string }[] = [
          { loc: `${BRAND.siteUrl}/`, priority: "0.9" },
          { loc: `${BRAND.siteUrl}/store`, priority: "0.9" },
          { loc: `${BRAND.siteUrl}/collections`, priority: "0.7" },
          { loc: `${BRAND.siteUrl}/journal`, priority: "0.8" },
          { loc: `${BRAND.siteUrl}/reviews`, priority: "0.6" },
          { loc: `${BRAND.siteUrl}/legal`, priority: "0.4" },
          { loc: `${BRAND.siteUrl}/contact`, priority: "0.6" },
        ];

        try {
          const { listStorefrontCollections, listStorefrontProducts } = await import(
            "@/lib/public-api/storefront.server"
          );
          const [articles, documents, importedPolicies, collections] = await Promise.all([
            listPublicArticles({}),
            listPublicLegalDocuments({}),
            listPublicLegalSources({}),
            listStorefrontCollections(),
          ]);
          // Paged so the whole visible catalogue is listed, bounded so the
          // sitemap can never turn into an unbounded read.
          for (let page = 0; page < 20; page += 1) {
            const batch = await listStorefrontProducts({ limit: 50, offset: page * 50 });
            for (const product of batch.items) {
              entries.push({
                loc: `${BRAND.siteUrl}/shop/${product.handle}`,
                lastmod: product.updated_at ?? undefined,
                priority: "0.8",
              });
            }
            if (!batch.hasMore) break;
          }

          for (const collection of collections) {
            entries.push({
              loc: `${BRAND.siteUrl}/collections/${collection.handle}`,
              lastmod: collection.updated_at ?? undefined,
              priority: "0.6",
            });
          }
          for (const article of articles) {
            entries.push({
              loc: `${BRAND.siteUrl}/journal/${article.slug}`,
              lastmod: article.published_at ?? undefined,
              priority: "0.7",
            });
          }
          for (const policy of importedPolicies) {
            entries.push({
              loc: `${BRAND.siteUrl}/legal/${policy.slug}`,
              lastmod: policy.shopify_updated_at ?? policy.last_synced_at,
              priority: "0.3",
            });
          }
          for (const doc of documents.filter(
            (item) => !importedPolicies.some((policy) => policy.slug === item.slug),
          )) {
            entries.push({
              loc: `${BRAND.siteUrl}/legal/${doc.slug}`,
              lastmod: doc.updated_at,
              priority: "0.3",
            });
          }
        } catch {
          // Static entries still ship if content reads fail.
        }

        const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    (entry) =>
      `  <url><loc>${entry.loc}</loc>${entry.lastmod ? `<lastmod>${new Date(entry.lastmod).toISOString()}</lastmod>` : ""}<priority>${entry.priority}</priority></url>`,
  )
  .join("\n")}
</urlset>`;

        return new Response(body, {
          headers: {
            "content-type": "application/xml; charset=utf-8",
            "cache-control": "public, max-age=600",
          },
        });
      },
    },
  },
});
