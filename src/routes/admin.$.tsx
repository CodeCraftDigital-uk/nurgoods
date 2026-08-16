import { createFileRoute, redirect } from "@tanstack/react-router";

/** Legacy nested admin paths redirect into the canonical /control console. */
export const Route = createFileRoute("/admin/$")({
  beforeLoad: ({ params }) => {
    const rest = (params as { _splat?: string })._splat ?? "";
    throw redirect({ href: rest ? `/control/${rest}` : "/control", replace: true });
  },
});
