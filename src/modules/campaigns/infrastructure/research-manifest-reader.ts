/**
 * The scheduler's handle on the latest Business Memory manifest identity.
 *
 * Identifiers only: the digest the tick compares and the revision it
 * records. Entry bytes stay behind their own access rules; the research
 * worker reads those later through its claim.
 */

export type ManifestListAnswer = {
  data: Record<string, unknown>[] | null;
  error: { code?: string; message?: string } | null;
};

export type ManifestListQuery = PromiseLike<ManifestListAnswer> & {
  eq(column: string, value: string): ManifestListQuery;
  order(column: string, options?: { ascending?: boolean }): ManifestListQuery;
  limit(count: number): ManifestListQuery;
};

export type ManifestTableClient = {
  from(table: string): { select(columns: string): ManifestListQuery };
};

export type ResearchManifestReader = {
  readManifestDigest(input: {
    organizationId: string;
  }): Promise<{ digest: string; revision: string } | null>;
};

export function createResearchManifestReader(
  client: ManifestTableClient,
): ResearchManifestReader {
  return {
    async readManifestDigest({ organizationId }) {
      const listed = await client
        .from("memory_context_manifests")
        .select("id,context_digest")
        .eq("organization_id", organizationId)
        .order("as_of", { ascending: false })
        .limit(1);
      if (listed.error) throw new Error("The memory manifest could not be read.");
      const row = (listed.data ?? [])[0] as
        | { id: string; context_digest: string }
        | undefined;
      if (!row) return null;
      return { digest: row.context_digest, revision: row.id };
    },
  };
}
