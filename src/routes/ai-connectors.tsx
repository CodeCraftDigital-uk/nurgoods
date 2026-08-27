import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Copy, MessageSquare, ShieldCheck, Sparkles } from "lucide-react";
import { PublicShell } from "@/components/public/PublicShell";
import { JsonLd } from "@/components/public/JsonLd";
import { Breadcrumbs } from "@/components/public/Breadcrumbs";
import { BRAND } from "@/lib/brand";

const PAGE_URL = `${BRAND.siteUrl}/ai-connectors`;
const TITLE = "AI Connectors | Shop NUR GOODS from ChatGPT or Claude";
const DESCRIPTION =
  "Connect the NUR GOODS catalogue to ChatGPT or Claude and search products, compare variants and check prices by simply asking. Read only, no account needed.";

export const Route = createFileRoute("/ai-connectors")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:url", content: PAGE_URL },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
    ],
    links: [{ rel: "canonical", href: PAGE_URL }],
  }),
  component: AiConnectorsPage,
});

const EXAMPLE_PROMPTS = [
  "Find me a wooden desk organiser under £60 at NUR GOODS.",
  "Show me NUR GOODS home accessories available under £25.",
  "Compare the variants of the Wooden Desk Organizer Set.",
  "What colours does that product come in, and which are in stock?",
  "Summarise the delivery information for that NUR GOODS product.",
  "Give me three NUR GOODS gift ideas for someone who works from home.",
] as const;

const FAQS = [
  {
    question: "What are NUR GOODS AI Connectors?",
    answer:
      "An AI Connector lets a compatible AI assistant read the public NUR GOODS catalogue while you chat with it. The connection uses the Model Context Protocol, an open standard that assistants such as ChatGPT and Claude support for adding custom tools.",
  },
  {
    question: "Is NUR GOODS listed in the ChatGPT or Claude app directory?",
    answer:
      "No. NUR GOODS provides a custom remote connector that you add yourself using the endpoint on this page. It is not published in an official ChatGPT or Claude directory, so you will not find it by searching those app stores.",
  },
  {
    question: "Do I need a NUR GOODS account or a password?",
    answer:
      "No. The connector is read only and serves the same product information already published on the NUR GOODS website, so there is no sign in step and no personal data involved.",
  },
  {
    question: "Can an AI assistant place an order for me?",
    answer:
      "No. The connector cannot add to a basket, start a checkout, take payment or change anything at all. When you are ready to buy, the assistant links you to the product page and you order through the normal NUR GOODS checkout.",
  },
  {
    question: "What information can the assistant see?",
    answer:
      "Only public shop information: product titles and descriptions, images, categories, availability, active variants and options, current customer facing prices in pounds sterling, published policies and Journal articles. It cannot see customer details, orders, admin data or anything commercially internal.",
  },
  {
    question: "Are prices from the assistant accurate?",
    answer:
      "The connector reads the live published catalogue, so prices and availability reflect what is on the website at the time of the request. The product page is always the final word at the point of ordering.",
  },
  {
    question: "Which plans support custom connectors?",
    answer:
      "Availability differs by platform and plan, and both platforms change their menus from time to time. In ChatGPT, custom connectors sit behind Settings and the apps or developer mode area, and access depends on your plan and any workspace policy. In Claude, individual users add custom connectors from Settings, while Team and Enterprise workspaces may require an owner to add it at organisation level first.",
  },
] as const;

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard access can be blocked; the value stays selectable in the field.
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <label className="sr-only" htmlFor="connector-endpoint">
        NUR GOODS connector endpoint
      </label>
      <input
        id="connector-endpoint"
        readOnly
        value={value}
        onFocus={(event) => event.currentTarget.select()}
        className="min-h-12 w-full min-w-0 flex-1 rounded-xl border border-border/70 bg-surface px-4 font-mono text-sm text-foreground"
      />
      <button
        type="button"
        onClick={copy}
        className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-semibold text-brand-foreground transition-colors hover:bg-brand/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
      >
        {copied ? (
          <Check aria-hidden className="size-4" />
        ) : (
          <Copy aria-hidden className="size-4" />
        )}
        {copied ? "Copied" : "Copy"}
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? "Endpoint copied to the clipboard" : ""}
      </span>
    </div>
  );
}

function Steps({ items }: { items: string[] }) {
  return (
    <ol className="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground">
      {items.map((item, index) => (
        <li key={item} className="flex gap-3">
          <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
            {index + 1}
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  );
}

function AiConnectorsPage() {
  // Always advertise the canonical NUR GOODS endpoint, never the current host.
  const endpoint = `${BRAND.siteUrl}/mcp`;

  const chatgptSteps = [
    "Open ChatGPT on the web and go to Settings.",
    "Find the apps and connectors area. On some plans this sits under Apps and connectors, and adding your own server requires developer mode to be switched on in the advanced settings.",
    "Choose the option to add a custom connector or custom app, sometimes shown as creating a new connector or plugin.",
    "Name it NUR GOODS and paste the endpoint above as the server URL. Leave authentication set to none.",
    "Confirm the warning that you are adding your own connector, then save. ChatGPT will scan the server and list the available tools.",
    "Enable NUR GOODS from the tools or apps control in the chat composer, then ask it to search NUR GOODS.",
  ];

  const claudeSteps = [
    "Open Claude on the web and go to Settings, then Connectors. On some builds this is reached through Customize and then Connectors.",
    "Select Add custom connector.",
    "Name it NUR GOODS and paste the endpoint above as the remote MCP server URL.",
    "Leave the optional OAuth fields empty. The connector needs no credentials.",
    "Save, then wait for Claude to finish scanning the tools.",
    "Enable NUR GOODS in the chat composer and ask it about the range.",
  ];

  const otherSteps = [
    "Open your assistant's MCP server or custom connector settings.",
    "Create a remote MCP server connection using the streamable HTTP transport.",
    "Name it NUR GOODS and paste the endpoint above.",
    "Leave authentication empty, then save and let the client discover the tools.",
    "Start a new conversation and ask about NUR GOODS products.",
  ];

  return (
    <PublicShell>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQS.map((faq) => ({
            "@type": "Question",
            name: faq.question,
            acceptedAnswer: { "@type": "Answer", text: faq.answer },
          })),
        }}
      />

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border/70">
        <div aria-hidden className="brand-gradient absolute inset-0" />
        <div
          aria-hidden
          className="absolute -right-24 top-[-8rem] size-[26rem] rounded-full bg-brand/35 blur-3xl"
        />
        <div className="relative mx-auto w-full max-w-4xl px-5 pb-14 pt-10 sm:px-8 sm:pb-18 sm:pt-14">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-navy-foreground backdrop-blur">
            <Sparkles aria-hidden className="size-3.5 text-gold" />
            AI Connectors
          </span>
          <h1 className="mt-5 font-brand text-[2.3rem] font-semibold leading-[1.05] text-navy-foreground sm:text-5xl">
            Shop {BRAND.name} from your AI assistant
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-navy-foreground/85 sm:text-lg">
            Connect the {BRAND.name} catalogue to ChatGPT or Claude and find what you need by asking
            for it. The assistant searches the live range, compares variants and checks prices, then
            links you straight to the product page.
          </p>
          <div className="mt-8 glass-panel rounded-2xl p-4 sm:p-5">
            <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {BRAND.name} connector endpoint
            </h2>
            <div className="mt-3">
              <CopyField value={endpoint} />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Paste this address into your assistant's custom connector settings. It is a read only
              Model Context Protocol server and needs no sign in.
            </p>
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-4xl px-5 py-10 sm:px-8 sm:py-14">
        <Breadcrumbs items={[{ label: "AI Connectors" }]} />

        {/* What it does */}
        <section className="mt-8">
          <h2 className="font-display text-2xl font-semibold text-foreground">
            What you can ask for
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Once connected, your assistant can search the {BRAND.name} range in plain language,
            summarise a product, compare its options and tell you what is available. Try prompts
            like these.
          </p>
          <ul className="mt-5 grid gap-3 sm:grid-cols-2">
            {EXAMPLE_PROMPTS.map((prompt) => (
              <li
                key={prompt}
                className="flex gap-3 rounded-2xl border border-border/70 bg-surface p-4 text-sm leading-relaxed text-foreground"
              >
                <MessageSquare aria-hidden className="mt-0.5 size-4 shrink-0 text-brand" />
                <span>{prompt}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* Setup */}
        <section className="mt-14">
          <h2 className="font-display text-2xl font-semibold text-foreground">
            Connect your assistant
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            This is a custom connector you add yourself. {BRAND.name} is not listed in an official
            ChatGPT or Claude app directory, so you will not find it by searching inside those apps.
            Menu names move around from time to time, so look for the wording closest to the steps
            below.
          </p>

          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <article className="rounded-2xl border border-border/70 bg-surface p-5">
              <h3 className="font-display text-lg font-semibold text-foreground">ChatGPT</h3>
              <Steps items={chatgptSteps} />
              <p className="mt-4 rounded-xl bg-surface-muted p-3 text-xs leading-relaxed text-muted-foreground">
                <strong className="font-semibold text-foreground">Which plans support this?</strong>{" "}
                Custom connector support in ChatGPT depends on your plan and on workspace policy.
                Paid personal plans generally expose read style custom servers through developer
                mode, while Business, Enterprise and Edu workspaces manage connectors centrally and
                an administrator may need to approve or add it. It is not available on every plan.
              </p>
            </article>

            <article className="rounded-2xl border border-border/70 bg-surface p-5">
              <h3 className="font-display text-lg font-semibold text-foreground">Claude</h3>
              <Steps items={claudeSteps} />
              <p className="mt-4 rounded-xl bg-surface-muted p-3 text-xs leading-relaxed text-muted-foreground">
                <strong className="font-semibold text-foreground">Which plans support this?</strong>{" "}
                Individual Claude users on current supported plans can add custom remote connectors
                themselves. On Team and Enterprise plans an owner or administrator may need to add
                the connector at organisation level before it appears for everyone.
              </p>
            </article>
          </div>

          <article className="mt-5 rounded-2xl border border-border/70 bg-surface p-5">
            <h3 className="font-display text-lg font-semibold text-foreground">Other assistants</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Any assistant that supports remote Model Context Protocol servers can use the same
              endpoint.
            </p>
            <Steps items={otherSteps} />
          </article>
        </section>

        {/* Using it */}
        <section className="mt-14">
          <h2 className="font-display text-2xl font-semibold text-foreground">
            How to use it after connecting
          </h2>
          <ol className="mt-4 space-y-3 text-sm leading-relaxed text-muted-foreground">
            <li>
              Make sure the {BRAND.name} connector is switched on for the conversation. Most
              assistants show enabled tools next to the message box.
            </li>
            <li>
              Ask naturally, for example &ldquo;find me a wooden desk organiser under £60 at{" "}
              {BRAND.name}&rdquo;. Mentioning the brand helps the assistant choose the right tool.
            </li>
            <li>
              Ask follow up questions about options, sizes, colours, availability or delivery, and
              the assistant will look them up rather than guess.
            </li>
            <li>
              When you are ready, open the product link it gives you and order through the normal{" "}
              {BRAND.name} checkout.
            </li>
          </ol>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to="/store"
              className="inline-flex min-h-11 items-center rounded-xl bg-brand px-5 text-sm font-semibold text-brand-foreground transition-colors hover:bg-brand/90"
            >
              Browse the range
            </Link>
            <Link
              to="/"
              className="inline-flex min-h-11 items-center rounded-xl border border-border px-5 text-sm font-semibold text-foreground transition-colors hover:bg-surface-muted"
            >
              Back to home
            </Link>
          </div>
        </section>

        {/* Privacy */}
        <section className="mt-14 rounded-2xl border border-border/70 bg-surface p-5 sm:p-6">
          <h2 className="flex items-center gap-2 font-display text-2xl font-semibold text-foreground">
            <ShieldCheck aria-hidden className="size-5 text-brand" />
            Privacy and safety
          </h2>
          <ul className="mt-4 space-y-2.5 text-sm leading-relaxed text-muted-foreground">
            <li>The connector is read only. It cannot change anything on the shop.</li>
            <li>
              It serves only information already published on the {BRAND.name} website: products,
              images, categories, availability, prices, policies and Journal articles.
            </li>
            <li>
              It cannot see or return customer details, orders, payment information or anything
              internal to the business.
            </li>
            <li>
              It cannot add to a basket, start a checkout or place an order. Buying always happens
              through the normal {BRAND.name} checkout in your browser.
            </li>
            <li>
              No {BRAND.name} account or password is involved, because everything it reads is
              already public.
            </li>
          </ul>
        </section>

        {/* Troubleshooting */}
        <section className="mt-14">
          <h2 className="font-display text-2xl font-semibold text-foreground">Troubleshooting</h2>
          <dl className="mt-4 space-y-4 text-sm leading-relaxed">
            <div>
              <dt className="font-semibold text-foreground">
                I cannot find the custom connector option
              </dt>
              <dd className="mt-1 text-muted-foreground">
                Check that you are on the web version rather than a mobile app, and look under
                Settings for connectors, apps or developer mode. Some plans hide custom servers
                behind an advanced or developer toggle.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-foreground">My workspace blocks it</dt>
              <dd className="mt-1 text-muted-foreground">
                Team, Business and Enterprise workspaces often restrict who can add connectors. Ask
                an owner or administrator to add the endpoint at organisation level, then enable it
                for your account.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-foreground">The tool scan fails or times out</dt>
              <dd className="mt-1 text-muted-foreground">
                Confirm the address was pasted in full, including https and the ending /mcp, with no
                trailing spaces. Remove the connector, wait a moment and add it again.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-foreground">
                It connected but the assistant ignores it
              </dt>
              <dd className="mt-1 text-muted-foreground">
                Enable {BRAND.name} for the conversation from the tools control, start a fresh chat
                and mention {BRAND.name} by name in your question.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-foreground">Results look out of date</dt>
              <dd className="mt-1 text-muted-foreground">
                Assistants cache the tool list. Refresh or reconnect the connector in its settings,
                then start a new conversation.
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-foreground">Rate limited or temporary errors</dt>
              <dd className="mt-1 text-muted-foreground">
                The endpoint limits how many requests it will answer per minute to keep the shop
                fast for everyone. Wait a minute and ask again.
              </dd>
            </div>
          </dl>
        </section>

        {/* FAQ */}
        <section className="mt-14">
          <h2 className="font-display text-2xl font-semibold text-foreground">
            Frequently asked questions
          </h2>
          <dl className="mt-4 space-y-4">
            {FAQS.map((faq) => (
              <div
                key={faq.question}
                className="rounded-2xl border border-border/70 bg-surface p-5"
              >
                <dt className="font-display text-base font-semibold text-foreground">
                  {faq.question}
                </dt>
                <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">{faq.answer}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </PublicShell>
  );
}
