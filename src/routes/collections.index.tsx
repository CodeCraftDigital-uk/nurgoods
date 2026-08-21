import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The standalone collections listing has been retired from public navigation.
 * Collection data is still maintained and still powers classification, search,
 * the homepage category rail and individual collection pages, so this route
 * sends shoppers and crawlers to the store rather than returning a dead page.
 */
export const Route = createFileRoute("/collections/")({
  beforeLoad: () => {
    throw redirect({ to: "/store", replace: true });
  },
  component: () => null,
});
