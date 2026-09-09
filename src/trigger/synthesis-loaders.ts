import type {
  SynthesisBusinessFinding,
  SynthesisFindingCoverage,
  SynthesisMarketClaim,
} from "@/modules/growth-intelligence/application/synthesis-service";

/**
 * SDK-free compact mapping and branch scoping for synthesis evidence.
 *
 * This module depends on types only (erased at runtime): no
 * `@trigger.dev/sdk`, no Supabase client, no env access. It exists so the
 * findings/claims row mapping and branch scoping are reachable from
 * behavioral tests without importing the Trigger wiring's side effects.
 *
 * Raw measures never leave the database row: the compact finding carries
 * currency, units, periods, and lineage labels only, and the provider input
 * schema rejects anything else.
 */

export const SYNTHESIS_FINDING_LOADER_LIMIT = 200;
const SYNTHESIS_ID_READ_BATCH_SIZE = 100;

export function safeLimitationCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is string => typeof entry === "string" && /^[A-Z][A-Z0-9_]{2,80}$/.test(entry),
  );
}

function nullableCurrency(value: unknown): string | null {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value) ? value : null;
}

function nullableValueKind(value: unknown): SynthesisBusinessFinding["valueKind"] {
  return value === "money" || value === "count" || value === "ratio" ? value : null;
}

function nullableDate(value: unknown): string | null {
  return typeof value === "string" && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) ? value : null;
}

/**
 * Maps one `channel_findings` row to the compact finding identity the
 * synthesis provider accepts. Byte-identical to the previous inline mapping
 * in `src/trigger/growth-intelligence.ts` for the original fields (same
 * headline format, same severity default, same limitation filtering); the
 * lineage fields (analysis run, branch, periods, currency, units, scope,
 * staleness) are new.
 *
 * Scope is decided against the requested branch: a null-branch row is an
 * in-scope measurement for legacy organization synthesis, but only
 * broader context for a named branch. Callers must never present a
 * broader_context row as a branch measurement.
 */
export function toCompactBusinessFinding(
  row: unknown,
  requestedBranchId: string | null = null,
): SynthesisBusinessFinding {
  const record = (row ?? {}) as Record<string, unknown>;
  const branchId = typeof record.branch_id === "string" ? record.branch_id : null;
  return {
    id: record.id as string,
    digest: record.calculation_digest as string,
    code: record.code as string,
    severity: (record.severity ?? "low") as SynthesisBusinessFinding["severity"],
    headline: `${record.detector_key as string}: ${record.code as string}`.slice(0, 200),
    limitations: safeLimitationCodes(record.limitations),
    analysisRunId: record.analysis_run_id as string,
    branchId,
    periodStart: nullableDate(record.period_start),
    periodEnd: nullableDate(record.period_end),
    currency: nullableCurrency(record.currency),
    valueKind: nullableValueKind(record.value_kind),
    scope: branchId === null && requestedBranchId !== null ? "broader_context" : "branch",
    stale: record.quality_state !== "complete",
  };
}

export type BranchFindingScope = {
  organizationId: string;
  branchId: string | null;
  channelId: string | null;
  evidenceWindow: { start: string; end: string } | null;
};

function windowExcludes(
  row: Record<string, unknown>,
  window: { start: string; end: string },
): boolean {
  const start = nullableDate(row.period_start);
  const end = nullableDate(row.period_end);
  if (start === null || end === null) return false;
  return end < window.start || start > window.end;
}

/**
 * Branch-fenced finding selection over loaded `channel_findings` rows (each
 * row carries its analysis-run lineage as `run_status`, `run_branch_id`,
 * and `run_channel_id`).
 *
 * - Exact branch scope: rows from other named branches are excluded;
 *   organization-wide (null-branch) rows are kept as broader context for a
 *   named branch and as in-scope measurements for legacy organization
 *   synthesis. Missing branch rows mean a branch gap, never cross-branch
 *   or organization fallback.
 * - Run lineage: only findings from completed runs whose run scope agrees
 *   with the finding scope (run branch matches the finding branch; a set
 *   run channel must match the finding channel).
 * - Currency: only current (`open`) governed findings; superseded rows stay
 *   historical and never synthesize.
 * - Requested window: findings fully outside the window are excluded and
 *   counted; rows without periods are retained (their window is unknown).
 * - Deterministic: id-ordered with a hard 200-row cap.
 */
export function selectBranchFindings(
  rows: unknown[],
  scope: BranchFindingScope,
): { findings: SynthesisBusinessFinding[]; fresh: boolean; coverage: SynthesisFindingCoverage } {
  let excludedOutOfWindow = 0;
  const selected: SynthesisBusinessFinding[] = [];
  for (const row of rows) {
    const record = (row ?? {}) as Record<string, unknown>;
    const rowBranchId = typeof record.branch_id === "string" ? record.branch_id : null;
    if (rowBranchId !== null && rowBranchId !== scope.branchId) continue;
    if (scope.channelId !== null && record.channel_id !== scope.channelId) continue;
    if (record.kind !== "finding") continue;
    if (record.status !== "open") continue;
    if (record.run_status !== "completed") continue;
    const runBranchId = typeof record.run_branch_id === "string" ? record.run_branch_id : null;
    if (runBranchId !== rowBranchId) continue;
    const runChannelId = typeof record.run_channel_id === "string" ? record.run_channel_id : null;
    if (runChannelId !== null && runChannelId !== record.channel_id) continue;
    if (scope.evidenceWindow !== null && windowExcludes(record, scope.evidenceWindow)) {
      excludedOutOfWindow += 1;
      continue;
    }
    selected.push(toCompactBusinessFinding(row, scope.branchId));
  }
  selected.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const findings = selected.slice(0, SYNTHESIS_FINDING_LOADER_LIMIT);
  return {
    findings,
    fresh: findings.length > 0 && findings.every((finding) => !finding.stale),
    coverage: {
      scoped: findings.filter((finding) => finding.scope === "branch").length,
      broaderContext: findings.filter((finding) => finding.scope === "broader_context").length,
      excludedOutOfWindow,
    },
  };
}

export type BranchClaimScope = {
  organizationId: string;
  profileVersionId: string;
  branchId: string | null;
};

export type MarketClaimRow = Record<string, unknown>;
export type MarketClaimEventRow = { market_evidence_claim_id: string; event_type: string };
export type MarketClaimLinkRow = { market_evidence_claim_id: string; relation: string };

const TERMINAL_CLAIM_EVENTS = new Set(["expired", "withdrawn", "excluded", "erased"]);

/**
 * Eligible market-claim selection with exact branch/profile/research-run
 * lineage. Byte-identical eligibility to the previous inline loader in
 * `src/trigger/growth-intelligence.ts` (terminal events, paraphrase,
 * expiry, contradicts exclusion, supports/corroborates grading, stale_at
 * freshness, limitation filtering), plus one fence: a claim is admitted
 * only when its research run researched the requested branch. Each admitted
 * claim carries its research run and branch lineage for the provider input
 * and the SQL re-validation.
 */
export function toEligibleMarketClaims(input: {
  rows: MarketClaimRow[];
  events: MarketClaimEventRow[];
  links: MarketClaimLinkRow[];
  scope: BranchClaimScope;
  nowMs: number;
}): SynthesisMarketClaim[] {
  const terminal = new Set(
    input.events
      .filter((event) => TERMINAL_CLAIM_EVENTS.has(event.event_type))
      .map((event) => event.market_evidence_claim_id),
  );
  const relations = new Map<string, string[]>();
  for (const link of input.links) {
    const list = relations.get(link.market_evidence_claim_id) ?? [];
    list.push(link.relation);
    relations.set(link.market_evidence_claim_id, list);
  }
  const eligible: SynthesisMarketClaim[] = [];
  for (const row of input.rows) {
    const id = row.id as string;
    if (terminal.has(id)) continue;
    const runBranchId =
      typeof row.run_branch_id === "string" ? (row.run_branch_id as string) : null;
    if (runBranchId !== input.scope.branchId) continue;
    if (row.paraphrase === null) continue;
    const expiresAt = row.expires_at as string;
    if (Number.isNaN(Date.parse(expiresAt)) || Date.parse(expiresAt) <= input.nowMs) continue;
    const claimRelations = relations.get(id) ?? [];
    if (claimRelations.includes("contradicts")) continue;
    const supports = claimRelations.filter((relation) => relation === "supports").length;
    const corroborates = claimRelations.filter((relation) => relation === "corroborates").length;
    eligible.push({
      id,
      digest: row.claim_digest as string,
      paraphrase: row.paraphrase as string,
      quotation: (row.quotation ?? null) as string | null,
      geographicLayer: row.geographic_layer as SynthesisMarketClaim["geographicLayer"],
      geographyRef: row.geography_ref as string,
      supportGrade:
        corroborates > 0 || supports >= 2
          ? "corroborated"
          : supports === 1
            ? "single_source"
            : "contextual",
      freshness: Date.parse(row.stale_at as string) <= input.nowMs ? "stale" : "current",
      limitations: safeLimitationCodes(row.limitations),
      researchRunId: row.market_research_run_id as string,
      branchId: runBranchId,
    });
  }
  return eligible;
}

/**
 * Deterministic ID batching for `in()` reads: the claims loader pages
 * event/link lookups so a full 200-row claim set never becomes one
 * unbounded filter.
 */
export function chunkIdentifiers(ids: string[], size: number): string[][] {
  const batch = Math.max(1, Math.floor(size));
  const chunks: string[][] = [];
  for (let offset = 0; offset < ids.length; offset += batch) {
    chunks.push(ids.slice(offset, offset + batch));
  }
  return chunks;
}

export const SYNTHESIS_CLAIM_ID_READ_BATCH_SIZE = SYNTHESIS_ID_READ_BATCH_SIZE;
