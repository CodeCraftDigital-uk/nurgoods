import type { WorkflowStage } from "@/lib/types/platform";

/**
 * Provider agnostic AI contract.
 *
 * No credentials live in this module and none may ever be added to client code.
 * Implementations run server side only and read their keys from server
 * environment secrets. The UI talks to the workflow through this shape so the
 * provider can change without touching screens.
 */
export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiCompletionRequest {
  stage: WorkflowStage;
  promptVersionKey: string;
  messages: AiMessage[];
  /** Optional JSON schema the provider should conform its output to. */
  responseSchema?: Record<string, unknown>;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface AiCompletionResult {
  provider: string;
  model: string;
  text: string;
  parsed?: unknown;
  tokenInput?: number;
  tokenOutput?: number;
  costUsd?: number;
}

export interface ResearchQuery {
  query: string;
  freshnessDays?: number;
  maxResults?: number;
}

export interface ResearchSource {
  url: string;
  title?: string;
  publisher?: string;
  publishedDate?: string;
  excerpt?: string;
}

/** Any AI vendor is adapted to this interface on the server. */
export interface AiProviderAdapter {
  readonly id: string;
  readonly label: string;
  complete(request: AiCompletionRequest): Promise<AiCompletionResult>;
  /** Optional. Providers without live retrieval simply omit this. */
  research?(query: ResearchQuery): Promise<ResearchSource[]>;
}

/**
 * Research is the only editorial capability that still needs an external
 * service. The managed AI platform does not currently expose a runtime web
 * search or retrieval API, so live research stays an isolated optional
 * dependency behind this single secret.
 */
export const RESEARCH_SECRET_NAMES = {
  providerId: "RESEARCH_PROVIDER_ID",
  apiKey: "RESEARCH_PROVIDER_API_KEY",
} as const;

export interface AiProviderStatus {
  /** True when the managed AI service is available for generation. */
  configured: boolean;
  /** True when generation runs on the managed platform rather than owner keys. */
  managed: boolean;
  providerId: string | null;
  model: string | null;
  researchConfigured: boolean;
  researchProviderId: string | null;
  researchMissing: string[];
  missing: string[];
}
