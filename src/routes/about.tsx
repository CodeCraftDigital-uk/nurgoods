import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicShell } from "@/components/public/PublicShell";
import { Breadcrumbs } from "@/components/public/Breadcrumbs";
import { JsonLd } from "@/components/public/JsonLd";
import { FreeShippingLine } from "@/components/public/FreeShippingNote";
import { BRAND } from "@/lib/brand";

const URL = `${BRAND.siteUrl}/about`;
const DESCRIPTION =
  "NUR GOODS is an online marketplace that curates everyday goods from vetted third party suppliers and delivers to the United Kingdom and the United States.";

/**
 * Entity clarity page. Every statement here is a fact already established by
 * the platform: marketplace model, served markets, shipping treatment and the
 * published contact routes. Nothing about ownership, manufacturing,
 * registrations or history is asserted.
 */
export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: `About ${BRAND.name} | Curated everyday goods` },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: `About ${BRAND.name}` },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: URL },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: URL }],
  }),
  component: AboutPage,
});

const FACTS: { label: string; value: string }[] = [
  { label: "Model", value: "Online marketplace. We curate and resell, we do not manufacture." },
  { label: "Markets served", value: "United Kingdom and United States" },
  { label: "Shipping", value: "Free shipping in the UK and USA, included in the price shown" },
  { label: "Support", value: "Through the contact form on this site" },
  { label: "Social", value: `TikTok ${BRAND.tiktokHandle}` },
];

function AboutPage() {
  return (
    <PublicShell>
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "AboutPage",
            name: `About ${BRAND.name}`,
            url: URL,
            description: DESCRIPTION,
            isPartOf: { "@type": "WebSite", name: BRAND.name, url: BRAND.siteUrl },
          },
          {
            "@context": "https://schema.org",
            "@type": "OnlineStore",
            name: BRAND.name,
            url: BRAND.siteUrl,
            slogan: BRAND.tagline,
            sameAs: [BRAND.tiktokUrl],
            areaServed: [
              { "@type": "Country", name: "United Kingdom" },
              { "@type": "Country", name: "United States" },
            ],
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Home", item: `${BRAND.siteUrl}/` },
              { "@type": "ListItem", position: 2, name: "About", item: URL },
            ],
          },
        ]}
      />

      <section className="mx-auto w-full max-w-3xl px-5 pt-12 sm:px-8 sm:pt-16">
        <Breadcrumbs items={[{ label: "About", href: "/about" }]} />
        <h1 className="mt-4 font-brand text-4xl leading-tight text-foreground sm:text-5xl">
          About {BRAND.name}
        </h1>
        {/* Answer first, so people and answer engines get the definition
            without reading the rest of the page. */}
        <p className="mt-4 text-lg text-muted-foreground">{DESCRIPTION}</p>
        <p className="mt-3 text-muted-foreground">{BRAND.tagline}</p>
      </section>

      <section className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8">
        <dl className="glass-card grid gap-4 rounded-3xl p-6 sm:grid-cols-2">
          {FACTS.map((fact) => (
            <div key={fact.label}>
              <dt className="text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">
                {fact.label}
              </dt>
              <dd className="mt-1 text-sm text-foreground">{fact.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mx-auto w-full max-w-3xl px-5 pb-8 sm:px-8">
        <h2 className="font-brand text-2xl text-foreground">What we do</h2>
        <p className="mt-3 text-muted-foreground">
          We review products from third party suppliers, keep the ones that meet our standards for
          quality, delivery and value, and present them with clear descriptions, specifications and
          delivery information. Products are only listed once we hold verified supplier and shipping
          evidence for at least one of the markets we serve.
        </p>

        <h2 className="mt-10 font-brand text-2xl text-foreground">How ordering works</h2>
        <p className="mt-3 text-muted-foreground">
          You browse and choose here on {BRAND.siteUrl.replace("https://", "")}. Payment is taken on
          our secure hosted checkout, then the order is passed to the supplier who ships it to you.
          Order updates are sent to the email address you give at checkout.
        </p>
        <FreeShippingLine className="mt-4" />

        <h2 className="mt-10 font-brand text-2xl text-foreground">Policies and contact</h2>
        <p className="mt-3 text-muted-foreground">
          Our published policies cover privacy, cookies, terms, returns and refunds, and shipping
          and delivery.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            to="/legal"
            className="rounded-xl border border-border px-4 py-2 text-sm text-foreground transition hover:border-primary/40"
          >
            Policies and trust
          </Link>
          <Link
            to="/contact"
            className="rounded-xl border border-border px-4 py-2 text-sm text-foreground transition hover:border-primary/40"
          >
            Contact us
          </Link>
          <Link
            to="/store"
            className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Browse the store
          </Link>
        </div>
      </section>
    </PublicShell>
  );
}
