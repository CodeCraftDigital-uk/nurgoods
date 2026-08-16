import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The separate Shop listing has been consolidated into Store. Individual
 * product URLs are unchanged, only this listing moved, so the old path issues a
 * permanent redirect and keeps any search or filter parameters intact.
 */
export const Route = createFileRoute("/shop/")({
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/store",
      search: (search ?? {}) as never,
      statusCode: 301,
      replace: true,
    });
  },
  component: () => null,
});
