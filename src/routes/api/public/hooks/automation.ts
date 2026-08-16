import { createFileRoute } from "@tanstack/react-router";

/**
 * Scheduled entry point for the automated Journal.
 *
 * The database scheduler calls this endpoint with the project key. Each job
 * claims a dated run key internally, so a repeated call on the same day or in
 * the same month is safe and simply reports that the work already happened.
 */
export const Route = createFileRoute("/api/public/hooks/automation")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided =
          request.headers.get("apikey") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        const accepted = [
          process.env["SUPABASE_ANON_KEY"],
          process.env["SUPABASE_PUBLISHABLE_KEY"],
        ].filter((value): value is string => Boolean(value && value.length > 20));

        if (accepted.length === 0 || !accepted.some((value) => value === provided)) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        let jobKey = "";
        try {
          const body = (await request.json()) as { jobKey?: unknown };
          jobKey = typeof body?.jobKey === "string" ? body.jobKey : "";
        } catch {
          jobKey = "";
        }
        const allowed = new Set([
          "monthly_editorial_plan",
          "daily_article_publish",
          "catalogue_intelligence_backfill",
          "catalogue_intelligence_daily",
          "catalogue_quality_audit",
        ]);
        if (!allowed.has(jobKey)) {
          return Response.json({ error: "Unknown job" }, { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { runAutomationJob } = await import("@/lib/automation/runner.server");

        try {
          const result = await runAutomationJob(
            { supabase: supabaseAdmin as never, userId: null },
            jobKey,
          );
          return Response.json(result);
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "The job failed";
          return Response.json({ jobKey, status: "failed", message }, { status: 500 });
        }
      },
    },
  },
});
