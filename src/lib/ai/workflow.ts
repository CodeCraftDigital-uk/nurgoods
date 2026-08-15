import type { WorkflowStage } from "@/lib/types/platform";

/**
 * Provider agnostic definition of the editorial workflow. The UI, automation
 * jobs and future server side generation all read the pipeline from here so a
 * stage can be added without touching screens.
 */
export interface WorkflowStageDefinition {
  stage: WorkflowStage;
  label: string;
  summary: string;
  /** True when the stage must call live research before producing output. */
  requiresLiveResearch: boolean;
  /** True when a human has to sign the stage off before it can advance. */
  requiresHumanApproval: boolean;
  outputs: string[];
}

export const WORKFLOW_PIPELINE: WorkflowStageDefinition[] = [
  {
    stage: "topic_discovery",
    label: "Topic discovery",
    summary:
      "Derive candidate topics from the synced catalogue, collections, search demand and current retail or lifestyle themes.",
    requiresLiveResearch: false,
    requiresHumanApproval: false,
    outputs: ["Candidate topics", "Priority score", "Commercial relevance"],
  },
  {
    stage: "brief",
    label: "Brief",
    summary:
      "Turn an approved topic into a brief with target query, search intent, audience, angle and outline.",
    requiresLiveResearch: false,
    requiresHumanApproval: true,
    outputs: ["Target query", "Search intent", "Outline", "Key questions"],
  },
  {
    stage: "research",
    label: "Research",
    summary:
      "Gather live sources for any claim that depends on current information. Sources are stored before drafting begins.",
    requiresLiveResearch: true,
    requiresHumanApproval: false,
    outputs: ["Source list", "Accessed timestamps", "Extracted claims"],
  },
  {
    stage: "draft",
    label: "Draft",
    summary: "Write the article body against the brief and the stored research only.",
    requiresLiveResearch: false,
    requiresHumanApproval: false,
    outputs: ["Article body", "Excerpt", "Suggested title"],
  },
  {
    stage: "source_verification",
    label: "Source verification",
    summary:
      "Check every factual claim against a stored source. Unverified claims block publication.",
    requiresLiveResearch: true,
    requiresHumanApproval: true,
    outputs: ["Verified sources", "Flagged claims"],
  },
  {
    stage: "optimisation",
    label: "SEO, AEO, GEO and LLMO",
    summary:
      "Add answerable sections, entity clarity, heading hierarchy and query coverage without keyword stuffing.",
    requiresLiveResearch: false,
    requiresHumanApproval: false,
    outputs: ["Answerable sections", "Entity coverage", "FAQ candidates"],
  },
  {
    stage: "internal_links",
    label: "Internal links",
    summary: "Suggest internal links to products, collections and other articles.",
    requiresLiveResearch: false,
    requiresHumanApproval: true,
    outputs: ["Anchor text", "Target reference", "Rationale"],
  },
  {
    stage: "metadata_schema",
    label: "Metadata and schema",
    summary:
      "Produce meta title, meta description, canonical and structured data of the correct schema type.",
    requiresLiveResearch: false,
    requiresHumanApproval: false,
    outputs: ["Meta title", "Meta description", "Canonical", "Structured data"],
  },
  {
    stage: "approval",
    label: "Approval",
    summary: "A human reviews facts, tone and commercial fit before anything is queued.",
    requiresLiveResearch: false,
    requiresHumanApproval: true,
    outputs: ["Approval record", "Reviewer notes"],
  },
  {
    stage: "scheduling",
    label: "Scheduling",
    summary: "Queue the approved article for publication at a chosen time.",
    requiresLiveResearch: false,
    requiresHumanApproval: true,
    outputs: ["Scheduled time", "Publication record"],
  },
];

export function stageIndex(stage: WorkflowStage): number {
  return WORKFLOW_PIPELINE.findIndex((item) => item.stage === stage);
}

export function nextStage(stage: WorkflowStage): WorkflowStage | null {
  const index = stageIndex(stage);
  if (index < 0 || index >= WORKFLOW_PIPELINE.length - 1) return null;
  return WORKFLOW_PIPELINE[index + 1]!.stage;
}

/** Stages the assisted generation runtime can execute. All others stay human led. */
export const RUNNABLE_STAGES: WorkflowStage[] = [
  "draft",
  "optimisation",
  "internal_links",
  "metadata_schema",
];
