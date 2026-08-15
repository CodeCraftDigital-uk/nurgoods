/** Small helpers so every tool returns the same shape. */
export function textResult(text: string, structured?: unknown) {
  return {
    content: [{ type: "text" as const, text }],
    ...(structured === undefined
      ? {}
      : { structuredContent: structured as Record<string, unknown> }),
  };
}

export function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}
