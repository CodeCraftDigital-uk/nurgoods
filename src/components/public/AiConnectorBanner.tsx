import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";

/**
 * Glass announcement for the AI Connectors page. Sits above the hero on the
 * homepage and stays quiet: no autoplay motion, one clear action.
 */
export function AiConnectorBanner() {
  return (
    <div className="mx-auto w-full max-w-7xl px-5 pt-5 sm:px-8 sm:pt-6">
      <Link
        to="/ai-connectors"
        className="group relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-white/25 bg-white/10 p-4 backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-transparent sm:flex-row sm:items-center sm:gap-5 sm:rounded-3xl sm:p-5"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute -left-16 top-1/2 size-48 -translate-y-1/2 rounded-full bg-gold/20 blur-3xl transition-opacity duration-500 group-hover:opacity-80"
        />
        <span className="relative inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/25 bg-white/15 text-gold sm:size-11">
          <Sparkles aria-hidden className="size-5" />
        </span>
        <span className="relative min-w-0 flex-1">
          <span className="inline-flex items-center gap-2 text-[0.62rem] font-semibold uppercase tracking-[0.2em] text-gold">
            New
            <span aria-hidden className="size-1 rounded-full bg-gold/70" />
            Shop NUR GOODS with AI
          </span>
          <span className="mt-1 block text-sm leading-relaxed text-navy-foreground/85 sm:text-[0.95rem]">
            Connect our catalogue to ChatGPT or Claude and find products through a simple
            conversation.
          </span>
        </span>
        <span className="relative inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl border border-white/30 bg-white/15 px-4 text-sm font-semibold text-navy-foreground transition-colors group-hover:bg-white/25">
          Set up AI Connectors
          <span aria-hidden className="ml-2 transition-transform group-hover:translate-x-0.5">
            &rarr;
          </span>
        </span>
      </Link>
    </div>
  );
}
