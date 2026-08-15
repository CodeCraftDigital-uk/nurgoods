/**
 * Shared contact enquiry contract. Pure values and validation only, safe on
 * both the browser and the server. The same schema runs in both places so a
 * customer sees friendly errors and the server never trusts the browser.
 */
import { z } from "zod";

export const ENQUIRY_CATEGORIES = [
  { value: "order_help", label: "Order help" },
  { value: "delivery", label: "Delivery" },
  { value: "returns_refunds", label: "Returns and refunds" },
  { value: "product_question", label: "Product question" },
  { value: "general", label: "General enquiry" },
] as const;

export type EnquiryCategory = (typeof ENQUIRY_CATEGORIES)[number]["value"];

export const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  ENQUIRY_CATEGORIES.map((item) => [item.value, item.label]),
);

export const contactSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, { message: "Please tell us your name" })
    .max(80, { message: "Please use 80 characters or fewer" }),
  email: z
    .string()
    .trim()
    .email({ message: "Please enter a valid email address" })
    .max(160, { message: "Please use 160 characters or fewer" }),
  category: z.enum(["order_help", "delivery", "returns_refunds", "product_question", "general"], {
    message: "Please choose an enquiry type",
  }),
  orderNumber: z
    .string()
    .trim()
    .max(40, { message: "Please use 40 characters or fewer" })
    .optional()
    .or(z.literal("")),
  subject: z
    .string()
    .trim()
    .min(3, { message: "Please add a short subject" })
    .max(140, { message: "Please use 140 characters or fewer" }),
  message: z
    .string()
    .trim()
    .min(20, { message: "Please give us a little more detail" })
    .max(4000, { message: "Please use 4000 characters or fewer" }),
  privacyAccepted: z.literal(true, { message: "Please accept the privacy notice" }),
});

export type ContactInput = z.infer<typeof contactSchema>;

export const ENQUIRY_STATUS_LABEL: Record<string, string> = {
  received: "Stored",
  email_sent: "Emailed",
  email_failed: "Email failed",
  email_unconfigured: "Email pending setup",
  spam_rejected: "Blocked",
};
