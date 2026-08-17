/**
 * The only text sent to an embedding provider. Structured values deliberately
 * remain out of the embedding boundary because they can carry more data than
 * a retrieval query needs.
 */
export function embeddingTextFor(input: { title: string; body?: string | null }): string {
  return [input.title, input.body ?? ""].join("\n\n").slice(0, 8_000).trim();
}
