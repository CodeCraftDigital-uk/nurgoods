import { createFileRoute, Link } from "@tanstack/react-router";
import { PublicShell } from "@/components/public/PublicShell";
import { Breadcrumbs } from "@/components/public/Breadcrumbs";
import { JsonLd } from "@/components/public/JsonLd";
import { BRAND } from "@/lib/brand";

const URL = `${BRAND.siteUrl}/faq`;
const DESCRIPTION =
  "Answers to common questions about NUR GOODS: what we are, where we deliver, shipping costs, payment, order updates, returns and how to contact support.";

/**
 * Answer hub. Every answer below restates a fact already established by the
 * platform: marketplace model, served markets, free shipping treatment,
 * hosted checkout, supplier despatch and the published contact routes.
 * Nothing about timescales, guarantees or registrations is invented.
 */
const FAQS: { question: string; answer: string }[] = [
  {
    question: "What is NUR GOODS?",
    answer:
      "NUR GOODS is an online marketplace that curates everyday goods from vetted third party suppliers. We select and resell products, we do not manufacture them.",
  },
  {
    question: "Where does NUR GOODS deliver?",
    answer:
      "We serve the United Kingdom and the United States. A product is only listed once we hold verified supplier and shipping evidence for at least one of those markets.",
  },
  {
    question: "How much is shipping?",
    answer:
      "Shipping is free in the UK and the USA. Delivery is included in the price shown on the product page, so there is no separate shipping charge at checkout.",
  },
  {
    question: "How do I pay?",
    answer:
      "Payment is taken on our secure hosted checkout after you choose your items here on nurgoods.com. Card details are handled by the checkout provider, never stored by us.",
  },
  {
    question: "How will I know my order is on the way?",
    answer:
      "Order updates are sent to the email address you give at checkout. Once the supplier despatches your order, tracking information is sent to that same address.",
  },
  {
    question: "Can I return something?",
    answer:
      "Returns and refunds are covered by our published returns and refunds policy. Read it on the policies page, or email support and we will guide you through it.",
  },
  {
    question: "How do I contact NUR GOODS?",
    answer: `Email ${BRAND.supportEmail} or use the contact page. You can also reach us on TikTok at ${BRAND.tiktokHandle}.`,
  },
  {
    question: "Are the reviews on the site genuine?",
    answer:
      "Yes. Reviews come from real orders placed through the NUR GOODS store and are published by our review provider exactly as written. We do not write or edit them.",
  },
];

export const Route = createFileRoute("/faq")({
  head: () => ({
    meta: [
      { title: `NUR GOODS FAQ: delivery, payment and returns` },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: `Frequently asked questions | ${BRAND.name}` },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: URL },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: URL }],
  }),
  component: FaqPage,
});

function FaqPage() {
  return (
    <PublicShell>
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            name: `${BRAND.name} frequently asked questions`,
            url: URL,
            isPartOf: { "@type": "WebSite", name: BRAND.name, url: BRAND.siteUrl },
            mainEntity: FAQS.map((item) => ({
              "@type": "Question",
              name: item.question,
              acceptedAnswer: { "@type": "Answer", text: item.answer },
            })),
          },
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Home", item: `${BRAND.siteUrl}/` },
              { "@type": "ListItem", position: 2, name: "FAQ", item: URL },
            ],
          },
        ]}
      />

      <section className="mx-auto w-full max-w-3xl px-5 pt-12 sm:px-8 sm:pt-16">
        <Breadcrumbs items={[{ label: "FAQ", href: "/faq" }]} />
        <h1 className="mt-4 font-brand text-4xl leading-tight text-foreground sm:text-5xl">
          Frequently asked questions
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">{DESCRIPTION}</p>
      </section>

      <section className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-8">
        <dl className="space-y-4">
          {FAQS.map((item) => (
            <div key={item.question} className="glass-card rounded-2xl p-6">
              <dt className="font-display text-lg font-semibold text-foreground">
                {item.question}
              </dt>
              <dd className="mt-2 leading-relaxed text-muted-foreground">{item.answer}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            to="/legal"
            className="rounded-xl border border-border px-4 py-2 text-sm text-foreground transition hover:border-primary/40"
          >
            Policies and trust
          </Link>
          <Link
            to="/about"
            className="rounded-xl border border-border px-4 py-2 text-sm text-foreground transition hover:border-primary/40"
          >
            About NUR GOODS
          </Link>
          <Link
            to="/contact"
            className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Contact us
          </Link>
        </div>
      </section>
    </PublicShell>
  );
}
