import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { PublicShell } from "@/components/public/PublicShell";
import { JsonLd } from "@/components/public/JsonLd";
import { Markdown } from "@/components/public/Markdown";
import { BRAND } from "@/lib/brand";
import {
  getPublicLegalDocument,
  getPublicLegalSource,
  getPublicLegalReference,
} from "@/lib/services/public-content.functions";

/**
 * A policy page is served from one of two authoritative places. Imported store
 * documents win, because the store is the source of truth for legal wording.
 * Locally authored documents remain supported for anything the store does not
 * hold. Nothing is rendered unless it has been reviewed and marked safe.
 */
export const Route = createFileRoute("/legal/$slug")({
  loader: async ({ params }) => {
    const imported = await getPublicLegalSource({ data: { slug: params.slug } });
    if (imported) return { kind: "imported" as const, imported };
    const local = await getPublicLegalDocument({ data: { slug: params.slug } });
    if (local) return { kind: "local" as const, local };
    // The store holds this policy but its wording only resolves there, so we
    // point visitors at the authoritative copy instead of showing raw markup.
    const reference = await getPublicLegalReference({ data: { slug: params.slug } });
    if (reference) return { kind: "reference" as const, reference };
    throw notFound();
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    if (loaderData.kind === "reference") {
      const refTitle = `${loaderData.reference.title} | ${BRAND.name}`;
      return {
        meta: [
          { title: refTitle },
          {
            name: "description",
            content: `Read the current ${loaderData.reference.title} for ${BRAND.name}.`,
          },
          { property: "og:title", content: refTitle },
          {
            property: "og:description",
            content: `Read the current ${loaderData.reference.title} for ${BRAND.name}.`,
          },
          { property: "og:type", content: "article" },
          { name: "twitter:card", content: "summary" },
        ],
        // The store copy is the authoritative version, so it stays canonical.
        links: [{ rel: "canonical", href: loaderData.reference.source_url }],
      };
    }
    const title =
      loaderData.kind === "imported" ? loaderData.imported.title : loaderData.local.title;
    const summary =
      loaderData.kind === "imported"
        ? loaderData.imported.summary
        : loaderData.local.summary;
    const slug =
      loaderData.kind === "imported" ? loaderData.imported.slug : loaderData.local.slug;
    const fullTitle = `${title} | ${BRAND.name}`;
    const description = summary ?? `${title} for ${BRAND.name} customers and visitors.`;
    return {
      meta: [
        { title: fullTitle },
        { name: "description", content: description },
        { property: "og:title", content: fullTitle },
        { property: "og:description", content: description },
        { property: "og:type", content: "article" },
        { name: "twitter:card", content: "summary" },
      ],
      // We render a complete, reviewed copy here, so this page is canonical.
      links: [{ rel: "canonical", href: `${BRAND.siteUrl}/legal/${slug}` }],
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

function Breadcrumb({ title, slug }: { title: string; slug: string }) {
  return (
    <>
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
              name: title,
              item: `${BRAND.siteUrl}/legal/${slug}`,
            },
          ],
        }}
      />
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground print:hidden">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="px-1.5">/</span>
        <Link to="/legal" className="hover:text-foreground">
          Policies
        </Link>
      </nav>
    </>
  );
}

function LegalDocumentPage() {
  const data = Route.useLoaderData();

  if (data.kind === "imported") {
    const doc = data.imported;
    const updated = doc.shopify_updated_at ?? doc.last_synced_at;
    return (
      <PublicShell>
        <article className="mx-auto w-full max-w-3xl px-5 pt-14 sm:px-8 sm:pt-20 print:max-w-none print:pt-0">
          <Breadcrumb title={doc.title} slug={doc.slug} />
          <h1 className="mt-4 font-display text-4xl leading-tight text-foreground sm:text-5xl">
            {doc.title}
          </h1>
          <p className="mt-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Last updated {new Date(updated).toLocaleDateString("en-GB")}
          </p>
          {doc.summary ? (
            <p className="mt-5 text-lg leading-relaxed text-muted-foreground">{doc.summary}</p>
          ) : null}
          <div
            className="legal-body mt-10 text-base leading-relaxed text-muted-foreground"
            // Markup is mirrored from the NUR GOODS store and passed through the
            // project allow list sanitiser before it reaches this component.
            dangerouslySetInnerHTML={{ __html: doc.body_html }}
          />
          <PolicyFooter />
        </article>
      </PublicShell>
    );
  }

  if (data.kind === "reference") {
    const ref = data.reference;
    return (
      <PublicShell>
        <article className="mx-auto w-full max-w-3xl px-5 pt-14 sm:px-8 sm:pt-20">
          <Breadcrumb title={ref.title} slug="" />
          <h1 className="mt-4 font-display text-4xl leading-tight text-foreground sm:text-5xl">
            {ref.title}
          </h1>
          <p className="mt-5 text-base leading-relaxed text-muted-foreground">
            This policy is maintained on the NUR GOODS store, where parts of the wording are
            generated for your location. To make sure you always read the version that applies to
            you, we link to the authoritative copy rather than showing an incomplete one here.
          </p>
          <a
            href={ref.source_url}
            className="mt-7 inline-flex min-h-11 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground"
          >
            Read the {ref.title.toLowerCase()}
          </a>
          <PolicyFooter />
        </article>
      </PublicShell>
    );
  }

  const doc = data.local;
  return (
    <PublicShell>
      <article className="mx-auto w-full max-w-3xl px-5 pt-14 sm:px-8 sm:pt-20 print:max-w-none print:pt-0">
        <Breadcrumb title={doc.title} slug={doc.slug} />
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
        <PolicyFooter />
      </article>
    </PublicShell>
  );
}

function PolicyFooter() {
  return (
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
  );
}
