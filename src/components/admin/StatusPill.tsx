import { cn } from "@/lib/utils";

export type StatusTone = "neutral" | "positive" | "pending" | "warning" | "danger";

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  positive: "bg-success/12 text-success",
  pending: "bg-accent text-accent-foreground",
  warning: "bg-warning/15 text-warning",
  danger: "bg-destructive/12 text-destructive",
};

export function StatusPill({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: StatusTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function statusTone(value: string | null | undefined): StatusTone {
  switch (value) {
    case "published":
    case "synced":
    case "succeeded":
    case "optimised":
    case "connected":
      return "positive";
    case "scheduled":
    case "in_review":
    case "in_progress":
    case "running":
    case "queued":
    case "pending":
      return "pending";
    case "needs_review":
    case "stale":
      return "warning";
    case "error":
    case "failed":
      return "danger";
    default:
      return "neutral";
  }
}

export function humanise(value: string | null | undefined): string {
  if (!value) return "Not set";
  return value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
