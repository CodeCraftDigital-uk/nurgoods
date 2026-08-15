import { createFileRoute, Link } from "@tanstack/react-router";
import { BrandLogo } from "@/components/admin/BrandLogo";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NUR GOODS Intelligence Platform" },
      {
        name: "description",
        content:
          "Commerce intelligence, content automation and integration layer for NUR GOODS. Shopify remains the source of truth for products, orders and checkout.",
      },
      { property: "og:title", content: "NUR GOODS Intelligence Platform" },
      {
        property: "og:description",
        content:
          "Catalogue intelligence, Journal automation, reviews, SEO and MCP readiness alongside the NUR GOODS Shopify store.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const LAYERS = [
  {
    title: "Commerce stays on Shopify",
    body: "Products, variants, inventory, customers, orders, checkout and payments remain in Shopify, with Zendrop handling fulfilment. This platform never replaces them.",
  },
  {
    title: "Intelligence and content automation",
    body: "Catalogue enrichment, the Journal editorial workflow, SEO records and review placements live here, with full provenance on every generated piece.",
  },
  {
    title: "Integration and MCP readiness",
    body: "Shopify Admin APIs, editorial AI, Publiko reviews and a future read only MCP surface for ChatGPT and Claude all connect through one place.",
  },
];

function Index() {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-4xl px-5 py-20 sm:px-8 sm:py-28">
        <div className="flex items-center gap-3">
          <BrandLogo size={44} />
          <p className="text-[0.7rem] font-medium uppercase tracking-[0.28em] text-muted-foreground">
            NUR GOODS
          </p>
        </div>
        <h1 className="mt-5 font-display text-4xl leading-tight text-foreground sm:text-5xl">
          Good things, brought to light.
        </h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground">
          The commerce intelligence and content platform behind the NUR GOODS store. Sign in to
          reach the admin console.
        </p>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            to="/admin"
            className="inline-flex min-h-11 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Open admin console
          </Link>
          <Link
            to="/auth"
            className="inline-flex min-h-11 items-center rounded-lg border border-input px-5 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Sign in
          </Link>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-3">
          {LAYERS.map((layer) => (
            <section key={layer.title} className="border-t-2 border-gold pt-5">
              <h2 className="text-sm font-semibold text-foreground">{layer.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{layer.body}</p>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
