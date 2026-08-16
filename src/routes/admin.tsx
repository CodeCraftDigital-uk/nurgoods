import { createFileRoute, redirect } from "@tanstack/react-router";

/** Legacy admin path. The canonical console lives at /control. */
export const Route = createFileRoute("/admin")({
  beforeLoad: () => {
    throw redirect({ to: "/control", replace: true });
  },
});
