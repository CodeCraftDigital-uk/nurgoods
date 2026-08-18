import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/control/orders")({
  component: () => <Outlet />,
});
