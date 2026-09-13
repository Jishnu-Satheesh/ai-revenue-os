import type { GrowthIntelligenceReadRepository } from "@/modules/growth-intelligence/infrastructure/read-repository";

/**
 * Qualified external evidence for campaign research (Task 6, C03, D07).
 *
 * Campaigns never queries Growth tables directly: this reader is the one
 * typed port, composing the existing Growth read repository. It answers the
 * only question research may ask of external evidence — is there something
 * qualified to cite, and exactly what — with every hazard as a named outcome
 * rather than an absence:
 *
 * - `unavailable`: nothing to cite (no requests, still running, failed).
 * - `expired`: the evidence aged out or every claim did.
 * - `conflicted`: the record changed under us and nothing clean remains.
 * - `private_excluded`: usable claims exist nowhere; everything usable-shaped
 *   was withheld or withdrawn. Research proceeds internal-only with gaps
 *   declared rather than citing what it cannot see.
 *
 * Reuse rights need no separate signal: Growth's own source policy already
 * qualified this evidence for this tenant, and anything from another tenant
 * can never arrive here — the composed repository is tenant-scoped, and
 * `admitProposal` refuses foreign evidence first anyway.
 *
 * Without a profile scope there are no claim citations, only the qualified
 * request. The planner then cannot support a market claim and must declare
 * the gap (D07) instead of citing a digest it never opened.
 */

export type CampaignEvidenceSource = Pick<
  GrowthIntelligenceReadRepository,
  "listRequests" | "listClaimPage" | "listSourcesByRuns" | "listEventsByClaims"
>;

export type CampaignEvidenceCitation = {
  researchRequestId: string;
  claimId: string;
  claimDigest: string;
  /**
   * Claim-level evidence carries no numbered revision; the claim digest is
   * the identity. Zero marks that honestly rather than inventing a version.
   */
  sourceRevision: 0;
  observedFrom: string;
  observedTo: string;
  sourceDomains: readonly string[];
};

export type CampaignEvidence =
  | {
      status: "qualified";
      requestId: string;
      /** False without a profile scope: cites nothing, declares gaps. */
      claimScope: boolean;
      citations: readonly CampaignEvidenceCitation[];
    }
  | { status: "unavailable"; requestId: string | null; reason: string; failureCode: string | null }
  | { status: "expired"; requestId: string; reason: string }
  | { status: "conflicted"; requestId: string; claimIds: readonly string[] }
  | { status: "private_excluded"; requestId: string };

const CLAIMS_PAGE_LIMIT = 50;

export type CampaignEvidenceReader = {
  read(input: {
    organizationId: string;
    evidenceMaxAgeDays: number;
    profileVersionId: string | null;
    now: Date;
  }): Promise<CampaignEvidence>;
};

export function createCampaignEvidenceReader(
  source: CampaignEvidenceSource,
): CampaignEvidenceReader {
  return {
    async read(input): Promise<CampaignEvidence> {
      const requests = (await source.listRequests({ organizationId: input.organizationId, limit: 10 }))
        .filter((request) => request.kind === "market_research");
      if (requests.length === 0) {
        return { status: "unavailable", requestId: null, reason: "no_requests", failureCode: null };
      }

      const latest = requests[0];
      if (latest.status === "pending" || latest.status === "claimed") {
        return { status: "unavailable", requestId: latest.id, reason: "in_flight", failureCode: null };
      }
      if (latest.status !== "succeeded") {
        return {
          status: "unavailable",
          requestId: latest.id,
          reason: "request_failed",
          failureCode: latest.safeFailureCode,
        };
      }

      const ageDays = (input.now.getTime() - Date.parse(latest.dueAt)) / 86_400_000;
      if (ageDays > input.evidenceMaxAgeDays) {
        return { status: "expired", requestId: latest.id, reason: "request_stale" };
      }

      if (input.profileVersionId === null) {
        return { status: "qualified", requestId: latest.id, claimScope: false, citations: [] };
      }

      const { claims } = await source.listClaimPage({
        organizationId: input.organizationId,
        profileVersionId: input.profileVersionId,
        limit: CLAIMS_PAGE_LIMIT,
      });
      if (claims.length === 0) {
        return { status: "unavailable", requestId: latest.id, reason: "no_claims", failureCode: null };
      }

      const runIds = [...new Set(claims.map((claim) => claim.runId))];
      const [sources, events] = await Promise.all([
        source.listSourcesByRuns({ organizationId: input.organizationId, runIds }),
        source.listEventsByClaims({
          organizationId: input.organizationId,
          claimIds: claims.map((claim) => claim.id),
        }),
      ]);

      const sourcesByRun = new Map<string, typeof sources>();
      for (const row of sources) {
        const list = sourcesByRun.get(row.runId) ?? [];
        list.push(row);
        sourcesByRun.set(row.runId, list);
      }
      const eventsByClaim = new Map<string, typeof events>();
      for (const event of events) {
        const list = eventsByClaim.get(event.claimId) ?? [];
        list.push(event);
        eventsByClaim.set(event.claimId, list);
      }

      const citations: CampaignEvidenceCitation[] = [];
      const tainted: string[] = [];
      let withheld = 0;
      let withoutSource = 0;
      let lapsed = 0;

      for (const claim of claims) {
        const claimEvents = eventsByClaim.get(claim.id) ?? [];
        const kinds = new Set(claimEvents.map((event) => event.eventType));
        if (kinds.has("withdrawn") || kinds.has("excluded")) {
          withheld += 1;
          continue;
        }
        if (kinds.has("expired") || Date.parse(claim.expiresAt) <= input.now.getTime()) {
          lapsed += 1;
          continue;
        }
        const available = (sourcesByRun.get(claim.runId) ?? []).filter(
          (row) => row.availability === "available",
        );
        // No readable source behind the claim: the content is withheld
        // (unavailable or erased upstream), not absent.
        if (available.length === 0) {
          withoutSource += 1;
          continue;
        }
        if (kinds.has("corrected") || kinds.has("superseded")) {
          // The record changed under this claim. It is not cited, and if
          // nothing clean remains the whole set is conflicted rather than
          // silently narrowed.
          tainted.push(claim.id);
          continue;
        }
        citations.push({
          researchRequestId: latest.id,
          claimId: claim.id,
          claimDigest: claim.digest,
          sourceRevision: 0,
          observedFrom: claim.publishedAt ?? claim.observedAt ?? latest.dueAt,
          observedTo: claim.observedAt ?? latest.dueAt,
          sourceDomains: [...new Set(available.map((row) => row.domain))],
        });
      }

      if (citations.length > 0) {
        return { status: "qualified", requestId: latest.id, claimScope: true, citations };
      }
      if (tainted.length > 0) {
        return { status: "conflicted", requestId: latest.id, claimIds: tainted };
      }
      if (withheld + withoutSource === claims.length && claims.length > 0) {
        return { status: "private_excluded", requestId: latest.id };
      }
      return { status: "expired", requestId: latest.id, reason: "claims_lapsed" };
    },
  };
}
