import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { RoutePending } from "./components/public/RoutePending";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Public catalogue, collection and policy content changes slowly, so
        // navigating back and forth should not refetch on every mount.
        staleTime: 60 * 1000,
        gcTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
        refetchOnMount: false,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Warm the destination route on hover/focus of a link.
    defaultPreload: "intent",
    defaultPreloadDelay: 50,
    defaultPreloadStaleTime: 30 * 1000,
    // If a route still has work to do, show its own shell straight away rather
    // than holding the previous page on screen.
    defaultPendingMs: 120,
    defaultPendingMinMs: 250,
    defaultPendingComponent: RoutePending,
  });

  return router;
};
