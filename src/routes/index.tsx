import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicShell } from "@/components/public/PublicShell";
import { JsonLd } from "@/components/public/JsonLd";
import { ReviewPlacementSlot } from "@/components/public/ReviewPlacementSlot";
import { BRAND } from "@/lib/brand";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NUR GOODS | Good things, brought to light" },
      {
        name: "description",
        content:
          "NUR GOODS brings considered everyday goods to light. Read the Journal, see customer reviews and shop the full range with tracked UK delivery.",
      },
      { property: "og:title", content: "NUR GOODS | Good things, brought to light" },
      {
        property: "og:description",
        content:
          "Considered everyday goods, honest guidance and verified customer reviews from NUR GOODS.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: `${BRAND.siteUrl}/` }],
  }),
  component: Index,
});

const PILLARS = [
  {
    title: "Chosen with care",
    body: "Every product in the range is picked for how it performs in daily use, not for how loud it looks on a shelf.",
    to: BRAND.storeUrl,
    label: "Browse the range",
  },
  {
    title: "Guidance you can check",
    body: "The Journal answers the questions people actually ask, and lists the sources behind every claim so you can verify them yourself.",
    to: "/journal",
    label: "Read the Journal",
  },
  {
    title: "Reviews from real orders",
    body: "Customer feedback is collected from completed orders and published as written. Nothing is edited and nothing is invented.",
    to: "/reviews",
    label: "See reviews",
  },
] as const;

function Index() {
  return (
    <PublicShell>
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "Organization",
            name: BRAND.name,
            url: BRAND.siteUrl,
            slogan: BRAND.tagline,
            email: BRAND.supportEmail,
            sameAs: [BRAND.tiktokUrl],
            contactPoint: [
              {
                "@type": "ContactPoint",
                contactType: "customer support",
                email: BRAND.supportEmail,
                availableLanguage: "English",
              },
            ],
          },
          {
            "@context": "https://schema.org",
            "@type": "WebSite",
            name: BRAND.name,
            url: BRAND.siteUrl,
            publisher: { "@type": "Organization", name: BRAND.name },
          },
        ]}
      />

      <section className="mx-auto w-full max-w-5xl px-5 pt-16 sm:px-8 sm:pt-24">
        <p className="text-[0.7rem] font-medium uppercase tracking-[0.28em] text-muted-foreground">
          {BRAND.name}
        </p>
        <h1 className="mt-5 max-w-3xl font-display text-4xl leading-[1.08] text-foreground sm:text-6xl">
          {BRAND.tagline}
        </h1>
        <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          Considered everyday goods, clear guidance and reviews you can trust. Shopping and delivery
          are handled on the main store.
        </p>
        <div className="mt-9 flex flex-wrap gap-3">
          <a
            href={BRAND.storeUrl}
            className="inline-flex min-h-11 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Shop NUR GOODS
          </a>
          <Link
            to="/journal"
            className="inline-flex min-h-11 items-center rounded-lg border border-input px-5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Read the Journal
          </Link>
        </div>
      </section>

      <section className="mx-auto mt-20 w-full max-w-5xl px-5 sm:px-8">
        <div className="grid gap-8 sm:grid-cols-3">
          {PILLARS.map((pillar) => (
            <div key={pillar.title} className="border-t-2 border-gold pt-5">
              <h2 className="font-display text-xl text-foreground">{pillar.title}</h2>
              <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{pillar.body}</p>
              {pillar.to.startsWith("http") ? (
                <a
                  href={pillar.to}
                  className="mt-4 inline-block text-sm font-medium text-foreground underline decoration-gold underline-offset-4"
                >
                  {pillar.label}
                </a>
              ) : (
                <Link
                  to={pillar.to}
                  className="mt-4 inline-block text-sm font-medium text-foreground underline decoration-gold underline-offset-4"
                >
                  {pillar.label}
                </Link>
              )}
            </div>
          ))}
        </div>
      </section>

      <div className="mx-auto w-full max-w-5xl px-5 sm:px-8">
        <ReviewPlacementSlot surface="homepage" className="mt-20" />
      </div>

      <section className="mx-auto mt-20 w-full max-w-5xl px-5 sm:px-8">
        <div className="rounded-2xl border border-border/70 p-8 sm:p-10">
          <h2 className="font-display text-2xl text-foreground">Questions before you order?</h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Delivery timescales, returns and privacy are set out in full in the policy pages. If
            anything is unclear, write to us and a person will reply.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/legal"
              className="inline-flex min-h-11 items-center rounded-lg border border-input px-5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              Policies and trust
            </Link>
            <a
              href={`mailto:${BRAND.supportEmail}`}
              className="inline-flex min-h-11 items-center rounded-lg border border-input px-5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              {BRAND.supportEmail}
            </a>
          </div>
        </div>
      </section>
    </PublicShell>
  );
}
