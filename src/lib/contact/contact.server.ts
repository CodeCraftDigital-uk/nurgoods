/**
 * Server only contact enquiry handling.
 *
 * Trust boundary: everything arriving from the browser is treated as hostile.
 * The form carries a signed timestamp that only this module can mint, the
 * request origin is checked against the serving host, the payload is size
 * limited and reduced to plain text, and abuse controls key on a salted hash
 * of the caller address so no raw address is ever stored or logged.
 */
import { createHmac, timingSafeEqual } from "crypto";
import type { ContactInput } from "./contact";
import { CATEGORY_LABEL } from "./contact";

/** Where valid enquiries are sent once a sender domain is live. */
export const SUPPORT_INBOX = "support@nurgoods.com";

const MIN_FILL_MS = 4_000;
const MAX_TOKEN_AGE_MS = 2 * 60 * 60 * 1000;
const DUPLICATE_WINDOW_MS = 30 * 60 * 1000;
const HOURLY_LIMIT = 3;
const DAILY_LIMIT = 10;

function signingKey(): string {
  const key = process.env["CONTACT_FORM_SECRET"] ?? process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!key) throw new Error("unavailable");
  return key;
}

function sign(value: string): string {
  return createHmac("sha256", signingKey()).update(value).digest("hex");
}

/** Mints a signed form token so a bot cannot simply fake the timing field. */
export function issueFormToken(): string {
  const issued = Date.now().toString(36);
  return `${issued}.${sign(issued)}`;
}

export function verifyFormToken(token: string): { ok: boolean; tooFast: boolean } {
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, tooFast: false };
  const [issued, mac] = parts as [string, string];
  const expected = sign(issued);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, tooFast: false };
  const issuedAt = Number.parseInt(issued, 36);
  if (!Number.isFinite(issuedAt)) return { ok: false, tooFast: false };
  const age = Date.now() - issuedAt;
  if (age > MAX_TOKEN_AGE_MS || age < 0) return { ok: false, tooFast: false };
  if (age < MIN_FILL_MS) return { ok: false, tooFast: true };
  return { ok: true, tooFast: false };
}

/** Salted, non reversible fingerprint used only for abuse controls. */
export function fingerprintHash(value: string): string {
  return createHmac("sha256", signingKey()).update(`fp:${value}`).digest("hex").slice(0, 48);
}

/** Same origin check for a browser submitted form. */
export function originAllowed(request: Request): boolean {
  const host = request.headers.get("host");
  if (!host) return false;
  const candidate = request.headers.get("origin") ?? request.headers.get("referer");
  if (!candidate) return false;
  try {
    return new URL(candidate).host === host;
  } catch {
    return false;
  }
}

export function callerAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

/** Reduces submitted text to safe plain text and blocks header injection. */
export function plainText(value: string, max: number): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, max);
}

/** Email header fields must never carry line breaks. */
export function headerSafe(value: string, max: number): string {
  return plainText(value, max).replace(/[\r\n]+/g, " ");
}

export interface AbuseVerdict {
  allowed: boolean;
  duplicate: boolean;
}

export async function checkAbuse(input: {
  ipHash: string;
  contentHash: string;
}): Promise<AbuseVerdict> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const now = Date.now();

  const { data: duplicate } = await supabaseAdmin
    .from("contact_enquiries")
    .select("id")
    .eq("content_hash", input.contentHash)
    .gte("created_at", new Date(now - DUPLICATE_WINDOW_MS).toISOString())
    .limit(1);
  if ((duplicate ?? []).length > 0) return { allowed: false, duplicate: true };

  const { data: hourly } = await supabaseAdmin
    .from("contact_enquiries")
    .select("id")
    .eq("ip_hash", input.ipHash)
    .gte("created_at", new Date(now - 60 * 60 * 1000).toISOString());
  if ((hourly ?? []).length >= HOURLY_LIMIT) return { allowed: false, duplicate: false };

  const { data: daily } = await supabaseAdmin
    .from("contact_enquiries")
    .select("id")
    .eq("ip_hash", input.ipHash)
    .gte("created_at", new Date(now - 24 * 60 * 60 * 1000).toISOString());
  if ((daily ?? []).length >= DAILY_LIMIT) return { allowed: false, duplicate: false };

  return { allowed: true, duplicate: false };
}

export interface DeliveryOutcome {
  status: "email_sent" | "email_failed" | "email_unconfigured";
  error: string | null;
}

/**
 * Mail abstraction. A sender domain has to be verified for this brand before
 * anything can actually leave the platform, so until then an enquiry is stored
 * and reported honestly as awaiting email setup rather than claimed as sent.
 */
export async function deliverSupportEmail(input: ContactInput & { id: string }): Promise<DeliveryOutcome> {
  const senderDomain = process.env["SUPPORT_SENDER_DOMAIN"];
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!senderDomain || !apiKey) {
    return {
      status: "email_unconfigured",
      error: "No verified sender domain is configured, so the enquiry is held in the admin inbox.",
    };
  }

  try {
    const { sendLovableEmail } = await import("@lovable.dev/email-js");
    const body = [
      `Category: ${CATEGORY_LABEL[input.category] ?? input.category}`,
      input.orderNumber ? `Order number: ${input.orderNumber}` : null,
      `From: ${input.name} <${input.email}>`,
      "",
      input.message,
    ]
      .filter(Boolean)
      .join("\n");

    await (sendLovableEmail as any)({
      apiKey,
      senderDomain,
      from: `NUR GOODS <support@${senderDomain}>`,
      to: SUPPORT_INBOX,
      replyTo: input.email,
      subject: `[${CATEGORY_LABEL[input.category] ?? "Enquiry"}] ${input.subject}`,
      text: body,
      idempotencyKey: `contact-${input.id}`,
    });
    return { status: "email_sent", error: null };
  } catch (error) {
    return {
      status: "email_failed",
      error: error instanceof Error ? error.message.slice(0, 300) : "Delivery failed",
    };
  }
}
