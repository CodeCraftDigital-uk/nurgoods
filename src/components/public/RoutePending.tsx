/**
 * Shown while a destination route is still resolving. It replaces the previous
 * page immediately so navigation never leaves stale content under a new URL.
 */
export function RoutePending() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-16" role="status" aria-live="polite">
      <span className="sr-only">Loading page</span>
      <div className="h-8 w-2/5 animate-pulse rounded-md bg-muted" />
      <div className="mt-4 h-4 w-3/5 animate-pulse rounded-md bg-muted" />
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-48 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    </div>
  );
}
