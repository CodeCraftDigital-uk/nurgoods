import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { PublicShell } from "@/components/public/PublicShell";
import { JsonLd } from "@/components/public/JsonLd";
import { Markdown } from "@/components/public/Markdown";
import { BRAND } from "@/lib/brand";
import { getPublicLegalDocument } from "@/lib/services/public-content.functions";

export const Route = createFileRoute("/legal/$slug")({
  loader: async ({ params }) => {
    const doc = await getPublicLegalDocument({ data: { slug: params.slug } });
    if (!doc) throw notFound();
    return doc;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const title = `${loaderData.title} | NUR GOODS`;
    const description =
      loaderData.summary ?? `${loaderData.title} for ${BRAND.name} customers and visitors.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "article" },
        { name: "twitter:card", content: "summary" },
      ],
      links: [{ rel: "canonical", href: `${BRAND.siteUrl}/legal/${loaderData.slug}` }],
    };
  },
  notFoundComponent: DocumentNotFound,
  component: LegalDocumentPage,
});

function DocumentNotFound() {
  return (
    <PublicShell>
      <div className="mx-auto w-full max-w-2xl px-5 py-24 text-center sm:px-8">
        <h1 className="font-display text-3xl text-foreground">Policy not available</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          This document has not been published yet. Contact {BRAND.supportEmail} if you need it now.
        </p>
        <Link
          to="/legal"
          className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground"
        >
          All policies
        </Link>
      </div>
    </PublicShell>
  );
}

function LegalDocumentPage() {
  const doc = Route.useLoaderData();

  return (
    <PublicShell>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: BRAND.siteUrl },
            { "@type": "ListItem", position: 2, name: "Policies", item: `${BRAND.siteUrl}/legal` },
            {
              "@type": "ListItem",
              position: 3,
              name: doc.title,
              item: `${BRAND.siteUrl}/legal/${doc.slug}`,
            },
          ],
        }}
      />
      <article className="mx-auto w-full max-w-3xl px-5 pt-14 sm:px-8 sm:pt-20">
        <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
          <Link to="/" className="hover:text-foreground">
            Home
          </Link>
          <span className="px-1.5">/</span>
          <Link to="/legal" className="hover:text-foreground">
            Policies
          </Link>
        </nav>
        <h1 className="mt-4 font-display text-4xl leading-tight text-foreground sm:text-5xl">
          {doc.title}
        </h1>
        <p className="mt-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Version {doc.version}
          {doc.effective_date
            ? ` · Effective ${new Date(doc.effective_date).toLocaleDateString("en-GB")}`
            : ""}
        </p>
        {doc.summary ? (
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">{doc.summary}</p>
        ) : null}
        <div className="mt-10">
          <Markdown source={doc.body_markdown} />
        </div>
        <p className="mt-12 text-sm text-muted-foreground">
          Questions about this policy? Write to{" "}
          <a
            href={`mailto:${BRAND.supportEmail}`}
            className="text-foreground underline decoration-gold underline-offset-4"
          >
            {BRAND.supportEmail}
          </a>
          .
        </p>
      </article>
    </PublicShell>
  );
}
