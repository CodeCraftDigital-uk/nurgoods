import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { PublicShell } from "@/components/public/PublicShell";
import { JsonLd } from "@/components/public/JsonLd";
import { BRAND } from "@/lib/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ENQUIRY_CATEGORIES, contactSchema } from "@/lib/contact/contact";
import { getContactFormToken, submitContactEnquiry } from "@/lib/contact/contact.functions";

const TITLE = `Contact us | ${BRAND.name}`;
const DESCRIPTION =
  "Get help with an order, delivery, a return or a product question. Message the NUR GOODS support team and we will come back to you by email.";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [{ rel: "canonical", href: `${BRAND.siteUrl}/contact` }],
  }),
  component: ContactPage,
});

type Errors = Partial<Record<string, string>>;

function ContactPage() {
  const tokenFn = useServerFn(getContactFormToken);
  const submitFn = useServerFn(submitContactEnquiry);

  const [token, setToken] = useState("");
  const [turnstileSiteKey, setTurnstileSiteKey] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [values, setValues] = useState({
    name: "",
    email: "",
    category: "order_help",
    orderNumber: "",
    subject: "",
    message: "",
  });
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [website, setWebsite] = useState("");
  const [company, setCompany] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    tokenFn({})
      .then((result) => {
        if (!active) return;
        setToken(result.token);
        setTurnstileSiteKey(result.turnstileSiteKey ?? null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [tokenFn]);

  function update(field: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    const parsed = contactSchema.safeParse({ ...values, privacyAccepted });
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "");
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      setStatus("error");
      setNotice("Please check the highlighted fields.");
      return;
    }
    setErrors({});
    setStatus("sending");
    try {
      const result = await submitFn({
        data: { ...values, privacyAccepted, token, website, company, turnstileToken },
      });
      if (result.ok) {
        setStatus("sent");
        setNotice(result.message);
        setValues({
          name: "",
          email: "",
          category: "order_help",
          orderNumber: "",
          subject: "",
          message: "",
        });
        setPrivacyAccepted(false);
      } else {
        setStatus("error");
        setNotice(result.message);
        const fresh = await tokenFn({}).catch(() => null);
        if (fresh) setToken(fresh.token);
        setTurnstileToken("");
      }
    } catch {
      setStatus("error");
      setNotice("We could not send that just now. Please try again in a few minutes.");
    }
  }

  return (
    <PublicShell>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ContactPage",
          name: `Contact ${BRAND.name}`,
          url: `${BRAND.siteUrl}/contact`,
          about: {
            "@type": "Organization",
            name: BRAND.name,
            url: BRAND.siteUrl,
            contactPoint: [
              {
                "@type": "ContactPoint",
                contactType: "customer support",
                url: `${BRAND.siteUrl}/contact`,
                availableLanguage: "English",
              },
            ],
          },
        }}
      />

      <div className="mx-auto w-full max-w-5xl px-5 pt-14 sm:px-8 sm:pt-20">
        <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Support</p>
        <h1 className="mt-3 max-w-2xl font-display text-4xl leading-tight text-foreground sm:text-5xl">
          We are here to help
        </h1>
        <p className="mt-4 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          Send us a message and our team will reply by email. Please include your order number if
          your question is about an existing order, as it helps us answer first time.
        </p>

        <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_320px]">
          <form onSubmit={onSubmit} noValidate className="order-2 lg:order-1">
            <div className="grid gap-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="name" label="Your name" error={errors["name"]}>
                  <Input
                    id="name"
                    value={values.name}
                    onChange={(event) => update("name", event.target.value)}
                    autoComplete="name"
                    maxLength={80}
                    aria-invalid={Boolean(errors["name"])}
                    aria-describedby={errors["name"] ? "name-error" : undefined}
                  />
                </Field>
                <Field id="email" label="Email address" error={errors["email"]}>
                  <Input
                    id="email"
                    type="email"
                    value={values.email}
                    onChange={(event) => update("email", event.target.value)}
                    autoComplete="email"
                    maxLength={160}
                    aria-invalid={Boolean(errors["email"])}
                    aria-describedby={errors["email"] ? "email-error" : undefined}
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="category" label="What is your enquiry about?" error={errors["category"]}>
                  <select
                    id="category"
                    value={values.category}
                    onChange={(event) => update("category", event.target.value)}
                    className="flex h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {ENQUIRY_CATEGORIES.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  id="orderNumber"
                  label="Order number"
                  hint="Optional"
                  error={errors["orderNumber"]}
                >
                  <Input
                    id="orderNumber"
                    value={values.orderNumber}
                    onChange={(event) => update("orderNumber", event.target.value)}
                    maxLength={40}
                  />
                </Field>
              </div>

              <Field id="subject" label="Subject" error={errors["subject"]}>
                <Input
                  id="subject"
                  value={values.subject}
                  onChange={(event) => update("subject", event.target.value)}
                  maxLength={140}
                  aria-invalid={Boolean(errors["subject"])}
                  aria-describedby={errors["subject"] ? "subject-error" : undefined}
                />
              </Field>

              <Field id="message" label="Message" error={errors["message"]}>
                <Textarea
                  id="message"
                  value={values.message}
                  onChange={(event) => update("message", event.target.value)}
                  rows={8}
                  maxLength={4000}
                  aria-invalid={Boolean(errors["message"])}
                  aria-describedby={errors["message"] ? "message-error" : undefined}
                />
              </Field>

              {/* Hidden from people and assistive technology. Only bots complete these. */}
              <div aria-hidden="true" className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
                <label htmlFor="website">Website</label>
                <input
                  id="website"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(event) => setWebsite(event.target.value)}
                />
                <label htmlFor="company">Company</label>
                <input
                  id="company"
                  name="company"
                  tabIndex={-1}
                  autoComplete="off"
                  value={company}
                  onChange={(event) => setCompany(event.target.value)}
                />
              </div>

              <div className="flex items-start gap-3">
                <input
                  id="privacy"
                  type="checkbox"
                  checked={privacyAccepted}
                  onChange={(event) => setPrivacyAccepted(event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-input"
                  aria-invalid={Boolean(errors["privacyAccepted"])}
                />
                <Label htmlFor="privacy" className="text-sm font-normal text-muted-foreground">
                  I understand my details will be used to answer this enquiry, as described in the{" "}
                  <Link
                    to="/legal"
                    className="text-foreground underline decoration-gold underline-offset-4"
                  >
                    privacy policy
                  </Link>
                  .
                </Label>
              </div>
              {errors["privacyAccepted"] ? (
                <p className="text-sm text-destructive">{errors["privacyAccepted"]}</p>
              ) : null}

              {turnstileSiteKey ? (
                <TurnstileWidget siteKey={turnstileSiteKey} onToken={setTurnstileToken} />
              ) : null}

              <div className="flex flex-wrap items-center gap-4">
                <Button type="submit" disabled={status === "sending"} className="min-h-11 min-w-40">
                  {status === "sending" ? "Sending" : "Send message"}
                </Button>
                <p
                  role="status"
                  aria-live="polite"
                  className={
                    status === "error"
                      ? "text-sm text-destructive"
                      : "text-sm text-muted-foreground"
                  }
                >
                  {notice}
                </p>
              </div>
            </div>
          </form>

          <aside className="order-1 space-y-6 lg:order-2">
            <div className="rounded-xl border border-border p-5">
              <h2 className="font-display text-lg text-foreground">How we reply</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Send the form and a person will reply to the email address you give here. Our
                statutory business contact details are published in the{" "}
                <Link
                  to="/legal"
                  hash="business-and-contact-information"
                  className="text-foreground underline decoration-gold underline-offset-4"
                >
                  business and contact information
                </Link>{" "}
                disclosure.
              </p>
            </div>
            <div className="rounded-xl border border-border p-5">
              <h2 className="font-display text-lg text-foreground">What we can help with</h2>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                {ENQUIRY_CATEGORIES.map((item) => (
                  <li key={item.value}>{item.label}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-border p-5">
              <h2 className="font-display text-lg text-foreground">Policies</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Delivery, returns and refund terms are set out in our{" "}
                <Link
                  to="/legal"
                  className="text-foreground underline decoration-gold underline-offset-4"
                >
                  policies
                </Link>
                .
              </p>
            </div>
          </aside>
        </div>
        <div className="h-20" />
      </div>
    </PublicShell>
  );
}

/**
 * Renders the Cloudflare Turnstile challenge when a site key is configured.
 * The script is only loaded in that case, so an unconfigured deployment makes
 * no third party request at all.
 */
function TurnstileWidget({
  siteKey,
  onToken,
}: {
  siteKey: string;
  onToken: (token: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const globalWindow = window as unknown as {
      turnstile?: { render: (el: HTMLElement, options: Record<string, unknown>) => void };
    };

    const render = () => {
      if (!globalWindow.turnstile || container.childElementCount > 0) return;
      globalWindow.turnstile.render(container, {
        sitekey: siteKey,
        callback: (value: string) => onToken(value),
        "expired-callback": () => onToken(""),
        "error-callback": () => onToken(""),
      });
    };

    if (globalWindow.turnstile) {
      render();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.addEventListener("load", render);
    document.head.appendChild(script);
    return () => script.removeEventListener("load", render);
  }, [siteKey, onToken]);

  return <div ref={containerRef} aria-label="Verification check" className="min-h-[70px]" />;
}

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id} className="text-sm text-foreground">
        {label}
        {hint ? <span className="ml-2 text-xs text-muted-foreground">{hint}</span> : null}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
