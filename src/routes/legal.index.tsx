import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PublicShell } from "@/components/public/PublicShell";
import { BRAND } from "@/lib/brand";
import {
  listPublicLegalDocuments,
  listPublicLegalReferences,
  listPublicLegalSources,
} from "@/lib/services/public-content.functions";

export const Route = createFileRoute("/legal/")({
  // Server rendered so every policy link is present in the crawlable HTML.
  loader: async () => {
    // Client navigations must commit instantly: the page refetches through
    // React Query instead of blocking the route transition on the server.
    if (typeof window !== "undefined") return null;
    try {
      const [sources, documents, references] = await Promise.all([
        listPublicLegalSources({}),
        listPublicLegalDocuments({}),
        listPublicLegalReferences({}),
      ]);
      return { sources, documents, references };
    } catch {
      return null;
    }
  },
  head: () => ({
    meta: [
      { title: "Policies and trust | NUR GOODS" },
      {
        name: "description",
        content:
          "Privacy, cookies, terms, returns and refunds, shipping and delivery, contact, about and accessibility information for NUR GOODS.",
      },
      { property: "og:title", content: "Policies and trust | NUR GOODS" },
      {
        property: "og:description",
        content:
          "Read the published NUR GOODS policies covering privacy, returns, delivery and more.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${BRAND.siteUrl}/legal` },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: `${BRAND.siteUrl}/legal` }],
  }),
  component: LegalIndex,
});

function LegalIndex() {
  const initial = Route.useLoaderData();
  const fetchSources = useServerFn(listPublicLegalSources);
  const fetchDocs = useServerFn(listPublicLegalDocuments);
  const fetchReferences = useServerFn(listPublicLegalReferences);

  const sources = useQuery({
    queryKey: ["public-legal-sources"],
    queryFn: () => fetchSources({}),
    ...(initial ? { initialData: initial.sources } : {}),
    retry: false,
  });
  const documents = useQuery({
    queryKey: ["public-legal"],
    queryFn: () => fetchDocs({}),
    ...(initial ? { initialData: initial.documents } : {}),
    retry: false,
  });
  const references = useQuery({
    queryKey: ["public-legal-references"],
    queryFn: () => fetchReferences({}),
    ...(initial ? { initialData: initial.references } : {}),
    retry: false,
  });

  const imported = sources.data ?? [];
  const local = (documents.data ?? []).filter(
    (doc) => !imported.some((item) => item.slug === doc.slug),
  );
  const external = references.data ?? [];
  const isLoading = sources.isLoading || documents.isLoading;
  const total = imported.length + local.length + external.length;

  return (
    <PublicShell>
      <div className="mx-auto w-full max-w-3xl px-5 pt-14 sm:px-8 sm:pt-20">
        <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
          <Link to="/" className="hover:text-foreground">
            Home
          </Link>
          <span className="px-1.5">/</span>
          <span className="text-foreground">Policies</span>
        </nav>
        <h1 className="mt-4 font-display text-4xl leading-tight text-foreground sm:text-5xl">
          Policies and trust
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">
          These policies come straight from the NUR GOODS store, so what you read here is the same
          wording that applies at checkout. If a document you need is missing,{" "}
          <Link
            to="/contact"
            className="text-foreground underline decoration-gold underline-offset-4"
          >
            contact us
          </Link>{" "}
          and we will send it to you directly.
        </p>

        <div className="mt-10 space-y-3">
          {isLoading ? (
            [0, 1, 2].map((i) => (
              <div key={i} className="h-20 animate-pulse glass-card rounded-2xl bg-muted/40" />
            ))
          ) : total === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-10 text-center">
              <h2 className="font-display text-xl text-foreground">No policies published yet</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                Documents appear here once they have been finalised. For anything urgent,{" "}
                <Link to="/contact" className="text-foreground underline underline-offset-4">
                  contact us
                </Link>
                .
              </p>
            </div>
          ) : (
            <>
              {[...imported, ...local].map((doc) => (
                <Link
                  key={doc.slug}
                  to="/legal/$slug"
                  params={{ slug: doc.slug }}
                  className="block glass-card rounded-2xl p-5 transition-colors hover:border-brand"
                >
                  <h2 className="font-display text-lg text-foreground">{doc.title}</h2>
                  {doc.summary ? (
                    <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                      {doc.summary}
                    </p>
                  ) : null}
                </Link>
              ))}
              {external.map((item) => (
                <a
                  key={item.source_url}
                  href={item.source_url}
                  className="block glass-card rounded-2xl p-5 transition-colors hover:border-brand"
                  rel="noopener"
                >
                  <h2 className="font-display text-lg text-foreground">{item.title}</h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    Read the current version on the NUR GOODS store.
                  </p>
                </a>
              ))}
            </>
          )}
        </div>

        {/*
          Statutory trader information. UK online selling rules require an email
          contact in the trader disclosure, so this is the one public place on
          the site where the business email address is rendered.
        */}
        <section
          id="business-and-contact-information"
          aria-labelledby="business-and-contact-information-heading"
          className="mt-14 glass-card rounded-2xl p-6"
        >
          <h2
            id="business-and-contact-information-heading"
            className="font-display text-xl text-foreground"
          >
            Business and contact information
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            This is the trader information disclosure required for online selling in the United
            Kingdom.
          </p>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-[180px_1fr]">
            <dt className="text-muted-foreground">Trading name</dt>
            <dd className="text-foreground">{BRAND.name}</dd>
            <dt className="text-muted-foreground">Website</dt>
            <dd className="text-foreground">{BRAND.siteUrl}</dd>
            <dt className="text-muted-foreground">Statutory email contact</dt>
            <dd className="text-foreground">{BRAND.supportEmail}</dd>
            <dt className="text-muted-foreground">Preferred contact route</dt>
            <dd>
              <Link
                to="/contact"
                className="text-foreground underline decoration-gold underline-offset-4"
              >
                Contact us through the contact form
              </Link>
            </dd>
          </dl>
        </section>
        <div className="h-16" />
      </div>
    </PublicShell>
  );
}
