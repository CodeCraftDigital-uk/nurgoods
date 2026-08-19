import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PublicShell } from "@/components/public/PublicShell";
import { JsonLd } from "@/components/public/JsonLd";
import { BRAND } from "@/lib/brand";
import { listPublicArticles } from "@/lib/services/public-content.functions";

export const Route = createFileRoute("/journal/")({
  // Server rendered so the article list is crawlable and citable.
  loader: async () => {
    try {
      return await listPublicArticles({});
    } catch {
      return null;
    }
  },
  head: () => ({
    meta: [
      { title: "Journal: buying guides and care advice | NUR GOODS" },
      {
        name: "description",
        content:
          "Buying guides, care advice and considered writing from NUR GOODS. Every article is reviewed by a person before it is published.",
      },
      { property: "og:title", content: "Journal | NUR GOODS" },
      {
        property: "og:description",
        content:
          "Buying guides, care advice and considered writing from NUR GOODS, published only after human review.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${BRAND.siteUrl}/journal` },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: `${BRAND.siteUrl}/journal` }],
  }),
  component: JournalIndex,
});

function JournalIndex() {
  const initialArticles = Route.useLoaderData();
  const fetchArticles = useServerFn(listPublicArticles);
  const articles = useQuery({
    queryKey: ["public-articles"],
    queryFn: () => fetchArticles({}),
    ...(initialArticles ? { initialData: initialArticles } : {}),
    retry: false,
  });


  return (
    <PublicShell>
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "Blog",
            name: `${BRAND.name} Journal`,
            url: `${BRAND.siteUrl}/journal`,
            publisher: { "@type": "Organization", name: BRAND.name, url: BRAND.siteUrl },
          },
          {
            "@context": "https://schema.org",
            "@type": "ItemList",
            name: `${BRAND.name} Journal articles`,
            itemListElement: (articles.data ?? []).slice(0, 50).map((article, index) => ({
              "@type": "ListItem",
              position: index + 1,
              url: `${BRAND.siteUrl}/journal/${article.slug}`,
              name: article.title,
            })),
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Home", item: `${BRAND.siteUrl}/` },
              {
                "@type": "ListItem",
                position: 2,
                name: "Journal",
                item: `${BRAND.siteUrl}/journal`,
              },
            ],
          },
        ]}
      />

      <div className="mx-auto w-full max-w-5xl px-5 pb-8 pt-14 sm:px-8 sm:pt-20">
        <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
          <Link to="/" className="hover:text-foreground">
            Home
          </Link>
          <span className="px-1.5">/</span>
          <span className="text-foreground">Journal</span>
        </nav>
        <h1 className="mt-4 font-brand text-4xl leading-tight text-foreground sm:text-5xl">
          Journal
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">
          Guides, comparisons and care notes written to answer a real question. Sources are listed
          on every article and nothing is published without a person approving it.
        </p>
      </div>

      <div className="mx-auto w-full max-w-5xl px-5 sm:px-8">
        {articles.isLoading ? (
          <ul className="grid gap-5 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="h-44 animate-pulse glass-card rounded-2xl bg-muted/40" />
            ))}
          </ul>
        ) : articles.isError ? (
          <div className="glass-card rounded-2xl p-8 text-center">
            <h2 className="font-display text-xl text-foreground">Journal is unavailable</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Articles could not be loaded right now. Please try again shortly.
            </p>
          </div>
        ) : (articles.data ?? []).length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <h2 className="font-display text-xl text-foreground">Nothing published yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              The first articles are being prepared. Follow {BRAND.tiktokHandle} on TikTok or write
              to {BRAND.supportEmail} in the meantime.
            </p>
          </div>
        ) : (
          <ul className="grid gap-5 sm:grid-cols-2">
            {(articles.data ?? []).map((article) => (
              <li key={article.id}>
                <Link
                  to="/journal/$slug"
                  params={{ slug: article.slug }}
                  className="flex h-full flex-col overflow-hidden glass-card rounded-2xl transition-colors hover:border-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {article.hero_image_url ? (
                    <img
                      src={article.hero_image_url}
                      alt={article.hero_image_alt?.trim() || `${article.title} article image`}
                      width={800}
                      height={450}
                      loading="lazy"
                      decoding="async"
                      className="aspect-[16/9] w-full object-cover"
                    />
                  ) : null}
                  <div className="flex flex-1 flex-col p-6">
                  <p className="text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
                    {article.published_at
                      ? new Date(article.published_at).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })
                      : "Journal"}
                    {article.reading_minutes ? ` · ${article.reading_minutes} min read` : ""}
                  </p>
                  <h2 className="mt-3 font-display text-xl leading-snug text-foreground">
                    {article.title}
                  </h2>
                  {article.excerpt ? (
                    <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                      {article.excerpt}
                    </p>
                  ) : null}
                  {article.tags && article.tags.length > 0 ? (
                    <ul className="mt-4 flex flex-wrap gap-1.5">
                      {article.tags.slice(0, 3).map((tag) => (
                        <li
                          key={tag}
                          className="rounded-full bg-secondary px-2.5 py-1 text-[0.68rem] text-secondary-foreground"
                        >
                          {tag}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <span className="mt-auto pt-5 text-sm font-medium text-foreground">
                    Read article
                  </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PublicShell>
  );
}
