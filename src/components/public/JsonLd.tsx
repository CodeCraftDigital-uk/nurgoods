/**
 * Emits structured data for search engines and answer engines. Only pass
 * values that exist in stored content. Never assert ratings, prices or
 * credentials that have not been supplied.
 */
export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return (
    <script
      type="application/ld+json"
      // Serialised object only, never author supplied markup.
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, "\\u003c"),
      }}
    />
  );
}
