import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * Managed AI gateway access for the editorial engine.
 *
 * The platform uses the hosted managed AI service. No owner supplied model
 * credentials are required and no key is ever exposed to the browser.
 */

/** Default editorial model used by every runnable workflow stage. */
export const EDITORIAL_MODEL = "google/gemini-3.5-flash";

export function readManagedAiKey(): string | null {
  return process.env["LOVABLE_API_KEY"]?.trim() || null;
}

export function isManagedAiAvailable(): boolean {
  return Boolean(readManagedAiKey());
}

export function createManagedAiProvider(apiKey: string) {
  return createOpenAICompatible({
    name: "lovable",
    baseURL: "https://ai.gateway.lovable.dev/v1",
    headers: {
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
    },
  });
}
