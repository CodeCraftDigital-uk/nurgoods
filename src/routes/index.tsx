import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NUR GOODS Platform Foundation" },
      {
        name: "description",
        content:
          "Technical foundation for the NUR GOODS ecommerce intelligence, content automation and integration layer. Shopify remains the commerce source of truth.",
      },
      { property: "og:title", content: "NUR GOODS Platform Foundation" },
      {
        property: "og:description",
        content:
          "Companion intelligence and automation layer for the NUR GOODS Shopify store.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const LAYERS = [
  {
    title: "Commerce source of truth",
    body: "Shopify owns products, variants, inventory, customers, orders, checkout and payments. Zendrop handles fulfilment.",
  },
  {
    title: "Intelligence & automation layer",
    body: "This application stores structured content, automation records and integration state alongside the store.",
  },
  {
    title: "Integration surface",
    body: "Reserved for Shopify Admin APIs, AI services, Publiko reviews and an MCP connector for ChatGPT and Claude.",
  },
];

function Index() {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-6 py-24">
        <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">NUR GOODS</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          Platform foundation
        </h1>
        <p className="mt-4 max-w-xl text-muted-foreground">
          Scaffolding for the ecommerce intelligence, content automation and integration layer. No
          storefront, branding or business data has been created.
        </p>

        <div className="mt-12 space-y-6">
          {LAYERS.map((layer) => (
            <section key={layer.title} className="border-l-2 border-border pl-5">
              <h2 className="text-sm font-medium text-foreground">{layer.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{layer.body}</p>
            </section>
          ))}
        </div>

        <div className="mt-12 flex gap-3">
          <Link
            to="/admin"
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Open admin console
          </Link>
          <Link
            to="/auth"
            className="inline-flex items-center rounded-md border border-input px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
