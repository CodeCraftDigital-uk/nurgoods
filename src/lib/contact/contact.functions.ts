import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { contactSchema } from "./contact";
import {
  callerAddress,
  checkAbuse,
  deliverSupportEmail,
  fingerprintHash,
  headerSafe,
  issueFormToken,
  originAllowed,
  plainText,
  verifyFormToken,
} from "./contact.server";

/** Mints the signed timing token the contact form must return with a submission. */
export const getContactFormToken = createServerFn({ method: "GET" }).handler(async () => ({
  token: issueFormToken(),
}));

export interface ContactSubmitResult {
  ok: boolean;
  message: string;
}

export const submitContactEnquiry = createServerFn({ method: "POST" })
  .inputValidator((input: Record<string, unknown>) => input)
  .handler(async ({ data }): Promise<ContactSubmitResult> => {
    const generic = {
      ok: false,
      message: "We could not send that just now. Please try again in a few minutes.",
    };
    const accepted = {
      ok: true,
      message: "Thank you. Your message has reached our support team.",
    };

    const request = getRequest();
    if (!originAllowed(request)) return generic;

    // Honeypots. Real people never fill these in.
    const raw = data as Record<string, unknown>;
    if (typeof raw["website"] === "string" && raw["website"].trim().length > 0) return accepted;
    if (typeof raw["company"] === "string" && raw["company"].trim().length > 0) return accepted;

    const token = typeof raw["token"] === "string" ? raw["token"] : "";
    const verdict = verifyFormToken(token);
    if (!verdict.ok) {
      return verdict.tooFast
        ? { ok: false, message: "That was sent a little too quickly. Please try once more." }
        : generic;
    }

    const parsed = contactSchema.safeParse({
      name: raw["name"],
      email: raw["email"],
      category: raw["category"],
      orderNumber: raw["orderNumber"] ?? "",
      subject: raw["subject"],
      message: raw["message"],
      privacyAccepted: raw["privacyAccepted"],
    });
    if (!parsed.success) {
      return { ok: false, message: "Please check the form and try again." };
    }

    const clean = {
      name: headerSafe(parsed.data.name, 80),
      email: headerSafe(parsed.data.email, 160).toLowerCase(),
      category: parsed.data.category,
      orderNumber: headerSafe(parsed.data.orderNumber ?? "", 40),
      subject: headerSafe(parsed.data.subject, 140),
      message: plainText(parsed.data.message, 4000),
      privacyAccepted: true as const,
    };
    if (clean.message.length < 20 || clean.subject.length < 3) return generic;

    const ipHash = fingerprintHash(callerAddress(request));
    const contentHash = fingerprintHash(`${clean.email}|${clean.subject}|${clean.message}`);
    const abuse = await checkAbuse({ ipHash, contentHash });
    if (abuse.duplicate) return accepted;
    if (!abuse.allowed) {
      return {
        ok: false,
        message: "You have sent several messages recently. Please wait a little before sending another.",
      };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: inserted, error } = await supabaseAdmin
      .from("contact_enquiries")
      .insert({
        name: clean.name,
        email: clean.email,
        category: clean.category,
        order_number: clean.orderNumber || null,
        subject: clean.subject,
        message: clean.message,
        status: "received",
        ip_hash: ipHash,
        content_hash: contentHash,
      })
      .select("id")
      .single();
    if (error || !inserted) return generic;

    const outcome = await deliverSupportEmail({ ...clean, id: inserted.id as string });
    await supabaseAdmin
      .from("contact_enquiries")
      .update({
        status: outcome.status,
        delivery_error: outcome.error,
        email_attempted_at: new Date().toISOString(),
      })
      .eq("id", inserted.id as string);

    return accepted;
  });

/* ------------------------------ admin inbox ------------------------------ */

export interface ContactEnquiryRow {
  id: string;
  name: string;
  email: string;
  category: string;
  order_number: string | null;
  subject: string;
  message: string;
  status: string;
  delivery_error: string | null;
  handled: boolean;
  created_at: string;
}

export const listContactEnquiries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ContactEnquiryRow[]> => {
    const { data, error } = await context.supabase
      .from("contact_enquiries")
      .select(
        "id, name, email, category, order_number, subject, message, status, delivery_error, handled, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as ContactEnquiryRow[];
  });

export const setEnquiryHandled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; handled: boolean }) => ({
    id: String(input.id),
    handled: Boolean(input.handled),
  }))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("contact_enquiries")
      .update({ handled: data.handled })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Whether outbound support email can actually be delivered right now. */
export const getEmailReadiness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => ({
    configured: Boolean(process.env["SUPPORT_SENDER_DOMAIN"] && process.env["LOVABLE_API_KEY"]),
  }));
