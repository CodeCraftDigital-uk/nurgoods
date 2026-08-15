import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { PublicShell } from "@/components/public/PublicShell";
import { JsonLd } from "@/components/public/JsonLd";
import { Markdown } from "@/components/public/Markdown";
import { ReviewPlacementSlot } from "@/components/public/ReviewPlacementSlot";
import { BRAND } from "@/lib/brand";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getPublicArticle,
  listPublicArticles,
  type PublicArticleSummary,
} from "@/lib/services/public-content.functions";

/** Related published articles, preferring shared tags. Real content only. */
function useRelatedArticles(slug: string, tags: string[] | null): PublicArticleSummary[] {
  const fetchArticles = useServerFn(listPublicArticles);
  const query = useQuery({
    queryKey: ["public-articles"],
    queryFn: () => fetchArticles({}),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const others = (query.data ?? []).filter((item) => item.slug !== slug);
  const tagSet = new Set(tags ?? []);
  const scored = others
    .map((item) => ({
      item,
      score: (item.tags ?? []).filter((tag) => tagSet.has(tag)).length,
    }))
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map((entry) => entry.item);
}

export const Route = createFileRoute("/journal/$slug")({
  loader: async ({ params }) => {
    const article = await getPublicArticle({ data: { slug: params.slug } });
    if (!article) throw notFound();
    return article;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const title = loaderData.meta_title ?? `${loaderData.title} | NUR GOODS`;
    const description =
      loaderData.meta_description ?? loaderData.excerpt ?? `A Journal article from ${BRAND.name}.`;
    const image = loaderData.hero_image_url;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "article" },
        { name: "twitter:card", content: "summary_large_image" },
        ...(image && image.startsWith("https://")
          ? [
              { property: "og:image", content: image },
              { name: "twitter:image", content: image },
            ]
          : []),
      ],
      links: [
        {
          rel: "canonical",
          href: loaderData.canonical_url ?? `${BRAND.siteUrl}/journal/${loaderData.slug}`,
        },
      ],
    };
  },
  notFoundComponent: ArticleNotFound,
  component: ArticlePage,
});

function ArticleNotFound() {
  return (
    <PublicShell>
      <div className="mx-auto w-full max-w-2xl px-5 py-24 text-center sm:px-8">
        <h1 className="font-display text-3xl text-foreground">Article not found</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          This piece may have been moved or is not published yet.
        </p>
        <Link
          to="/journal"
          className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground"
        >
          Back to the Journal
        </Link>
      </div>
    </PublicShell>
  );
}

function ArticlePage() {
  const article = Route.useLoaderData();
  const canonical = article.canonical_url ?? `${BRAND.siteUrl}/journal/${article.slug}`;
  const faqs = article.faqs ?? [];
  const related = useRelatedArticles(article.slug, article.tags);

  const graph: Record<string, unknown>[] = [
    {
      "@context": "https://schema.org",
      "@type": article.schema_type ?? "BlogPosting",
      headline: article.title,
      description: article.meta_description ?? article.excerpt ?? undefined,
      datePublished: article.published_at ?? undefined,
      dateModified: article.updated_at,
      mainEntityOfPage: canonical,
      author: { "@type": "Organization", name: article.author_name ?? BRAND.name },
      publisher: { "@type": "Organization", name: BRAND.name, url: BRAND.siteUrl },
      ...(article.hero_image_url ? { image: article.hero_image_url } : {}),
      ...(article.sources.length > 0
        ? { citation: article.sources.map((source) => source.url) }
        : {}),
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: BRAND.siteUrl },
        { "@type": "ListItem", position: 2, name: "Journal", item: `${BRAND.siteUrl}/journal` },
        { "@type": "ListItem", position: 3, name: article.title, item: canonical },
      ],
    },
  ];

  if (faqs.length > 0) {
    graph.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqs.map((faq) => ({
        "@type": "Question",
        name: faq.question,
        acceptedAnswer: { "@type": "Answer", text: faq.answer },
      })),
    });
  }

  return (
    <PublicShell>
      <JsonLd data={graph} />
      <article className="mx-auto w-full max-w-3xl px-5 pt-14 sm:px-8 sm:pt-20">
        <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
          <Link to="/" className="hover:text-foreground">
            Home
          </Link>
          <span className="px-1.5">/</span>
          <Link to="/journal" className="hover:text-foreground">
            Journal
          </Link>
        </nav>

        <header className="mt-4">
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
          <h1 className="mt-3 font-display text-4xl leading-tight text-foreground sm:text-5xl">
            {article.title}
          </h1>
          {article.excerpt ? (
            <p className="mt-4 text-lg leading-relaxed text-muted-foreground">{article.excerpt}</p>
          ) : null}
        </header>

        {article.hero_image_url ? (
          <img
            src={article.hero_image_url}
            alt={article.hero_image_alt ?? article.title}
            loading="lazy"
            className="mt-8 w-full rounded-xl border border-border/70 object-cover"
          />
        ) : null}

        <div className="mt-10">
          {article.body_markdown ? (
            <Markdown source={article.body_markdown} />
          ) : (
            <p className="text-sm text-muted-foreground">This article has no body content yet.</p>
          )}
        </div>

        {faqs.length > 0 ? (
          <section className="mt-14" aria-labelledby="faq-heading">
            <h2 id="faq-heading" className="font-display text-2xl text-foreground">
              Common questions
            </h2>
            <dl className="mt-5 divide-y divide-border">
              {faqs.map((faq, index) => (
                <div key={index} className="py-4">
                  <dt className="text-sm font-semibold text-foreground">{faq.question}</dt>
                  <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {faq.answer}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {article.sources.length > 0 ? (
          <section className="mt-14" aria-labelledby="sources-heading">
            <h2 id="sources-heading" className="font-display text-2xl text-foreground">
              Sources
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {article.sources_verified
                ? "Each source below was checked by a person before publication."
                : "References used while researching this article."}
            </p>
            <ol className="mt-5 space-y-3">
              {article.sources.map((source) => (
                <li key={source.id} className="text-sm">
                  <a
                    href={source.url}
                    rel="nofollow noopener"
                    className="text-foreground underline decoration-gold underline-offset-4"
                  >
                    {source.title ?? source.url}
                  </a>
                  <span className="block text-xs text-muted-foreground">
                    {[source.publisher, source.author, source.published_date]
                      .filter(Boolean)
                      .join(" · ")}
                    {source.verified ? " · Verified" : ""}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {article.links.length > 0 ? (
          <section className="mt-14" aria-labelledby="links-heading">
            <h2 id="links-heading" className="font-display text-2xl text-foreground">
              Explore next
            </h2>
            <ul className="mt-4 space-y-2 text-sm">
              {article.links.map((link) => (
                <li key={link.id}>
                  {link.target_type === "article" ? (
                    <Link
                      to="/journal/$slug"
                      params={{ slug: link.target_reference }}
                      className="text-foreground underline decoration-gold underline-offset-4"
                    >
                      {link.anchor_text}
                    </Link>
                  ) : link.target_type === "collection" ? (
                    <Link
                      to="/collections/$handle"
                      params={{ handle: link.target_reference }}
                      className="text-foreground underline decoration-gold underline-offset-4"
                    >
                      {link.anchor_text}
                    </Link>
                  ) : (
                    <Link
                      to="/shop/$handle"
                      params={{ handle: link.target_reference }}
                      className="text-foreground underline decoration-gold underline-offset-4"
                    >
                      {link.anchor_text}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {related.length > 0 ? (
          <section className="mt-14" aria-labelledby="related-heading">
            <h2 id="related-heading" className="font-display text-2xl text-foreground">
              Keep reading
            </h2>
            <ul className="mt-5 grid gap-4 sm:grid-cols-3">
              {related.map((item) => (
                <li key={item.id}>
                  <Link
                    to="/journal/$slug"
                    params={{ slug: item.slug }}
                    className="flex h-full flex-col rounded-xl border border-border/70 p-5 transition-colors hover:border-gold"
                  >
                    <h3 className="font-display text-base leading-snug text-foreground">
                      {item.title}
                    </h3>
                    {item.excerpt ? (
                      <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
                        {item.excerpt}
                      </p>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <ReviewPlacementSlot surface="article_page" className="mt-16" />
      </article>

      <div className="mx-auto mt-16 w-full max-w-3xl px-5 sm:px-8">
        <div className="rounded-xl border border-border/70 p-6">
          <h2 className="font-display text-xl text-foreground">Shop the collection</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Browse the full {BRAND.name} range, with secure checkout and tracked delivery.
          </p>
          <a
            href={BRAND.storeUrl}
            className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Visit the store
          </a>
        </div>
      </div>
    </PublicShell>
  );
}
