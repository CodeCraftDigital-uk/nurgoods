import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PublicShell } from "@/components/public/PublicShell";
import { BRAND } from "@/lib/brand";
import { listPublicLegalDocuments } from "@/lib/services/public-content.functions";

export const Route = createFileRoute("/legal/")({
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
        content: "Read the published NUR GOODS policies covering privacy, returns, delivery and more.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LegalIndex,
});

function LegalIndex() {
  const fetchDocs = useServerFn(listPublicLegalDocuments);
  const documents = useQuery({
    queryKey: ["public-legal"],
    queryFn: () => fetchDocs({}),
    retry: false,
  });

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
          Only policies that have been written and approved appear here. If a document you need is
          missing, write to {BRAND.supportEmail} and we will send it to you directly.
        </p>

        <div className="mt-10">
          {documents.isLoading ? (
            <ul className="space-y-3">
              {[0, 1, 2].map((i) => (
                <li key={i} className="h-20 animate-pulse rounded-xl border border-border/70 bg-muted/40" />
              ))}
            </ul>
          ) : documents.isError ? (
            <p className="rounded-xl border border-border/70 p-6 text-sm text-muted-foreground">
              Policies could not be loaded right now. Please try again shortly.
            </p>
          ) : (documents.data ?? []).length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-10 text-center">
              <h2 className="font-display text-xl text-foreground">No policies published yet</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                Documents are published once the wording has been finalised. For anything urgent,
                contact {BRAND.supportEmail}.
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {(documents.data ?? []).map((doc) => (
                <li key={doc.id}>
                  <Link
                    to="/legal/$slug"
                    params={{ slug: doc.slug }}
                    className="block rounded-xl border border-border/70 p-5 transition-colors hover:border-gold"
                  >
                    <h2 className="font-display text-lg text-foreground">{doc.title}</h2>
                    {doc.summary ? (
                      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                        {doc.summary}
                      </p>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </PublicShell>
  );
}
