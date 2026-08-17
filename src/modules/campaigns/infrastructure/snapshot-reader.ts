/**
 * The pinned evidence a version was built on, read back for a later check.
 *
 * Restricted terms are the reason this exists. They are recorded at campaign
 * creation and every piece of copy is checked against them — including copy an
 * operator types by hand months later. Reading them from the snapshot rather
 * than from live settings keeps the rule the campaign was built under, which is
 * also the rule an approval was granted under.
 */

export type SnapshotFactsReader = {
  from(table: "campaign_source_snapshots"): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        eq(
          column: string,
          value: string,
        ): {
          maybeSingle(): Promise<{ data: { facts: unknown } | null; error: unknown }>;
        };
      };
    };
  };
};

export async function readRestrictedTerms(
  database: SnapshotFactsReader,
  input: { organizationId: string; sourceSnapshotId: string },
): Promise<readonly string[] | null> {
  const { data, error } = await database
    .from("campaign_source_snapshots")
    .select("facts")
    .eq("organization_id", input.organizationId)
    .eq("id", input.sourceSnapshotId)
    .maybeSingle();

  // `null` means "could not be read", which a caller must treat as a refusal.
  // Returning an empty list here would turn an unreadable snapshot into a
  // silently unrestricted one — the exact direction a mistake must not fall.
  if (error || !data) return null;

  const facts = data.facts;
  if (typeof facts !== "object" || facts === null) return [];

  const terms = (facts as Record<string, unknown>).restrictedTerms;
  if (!Array.isArray(terms)) return [];

  return terms.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}
