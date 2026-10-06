import { z } from "zod";

import type {
  ProposalDecisionRow,
  ProposalRow,
  ProposalVersionRow,
} from "@/modules/campaigns/application/proposal-read-model";

/**
 * Reading proposals back out.
 *
 * Every write in this module goes through a security-definer function, which is
 * why `proposal-repository.ts` declares only an `rpc` surface. Reads are the
 * other half and need nothing of the kind: the three proposal tables each carry
 * a `select` policy for members holding `campaign.read`, so an ordinary
 * session read is already tenant-scoped by row level security. The
 * organization predicate below is belt as well as braces, not the fence itself.
 *
 * Three flat reads matched in memory, rather than one nested select. That is
 * the house style throughout this repository, and it earns its keep here: a
 * proposal with no version yet is normal, and a nested select would make the
 * absence of a version indistinguishable from the absence of a proposal.
 */

type Row = Record<string, unknown>;

type Result = { data: Row[] | null; error: { message?: string } | null };

type Filter = {
  eq(column: string, value: string): Filter & PromiseLike<Result>;
  in(column: string, values: readonly string[]): Filter & PromiseLike<Result>;
  order(column: string, options: { ascending: boolean }): Filter & PromiseLike<Result>;
  limit(count: number): Filter & PromiseLike<Result>;
};

export type ProposalReadPersistence = {
  from(
    table: "campaign_proposals" | "campaign_proposal_versions" | "campaign_proposal_decisions",
  ): { select(columns: string): Filter & PromiseLike<Result> };
};

const proposalSchema = z.object({
  id: z.string().uuid(),
  source_kind: z.string(),
  source_id: z.string().uuid().nullable(),
  state: z.string(),
  current_version_id: z.string().uuid().nullable(),
  linked_campaign_id: z.string().uuid().nullable(),
  snoozed_until: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const versionSchema = z.object({
  id: z.string().uuid(),
  proposal_id: z.string().uuid(),
  version: z.number().int(),
  // Left as unknown on purpose. The document is parsed by the read model
  // against the current schema, and a stored shape that no longer satisfies it
  // must surface as unreadable rather than fail the whole page.
  document: z.unknown(),
  digest: z.string(),
  created_at: z.string(),
});

const decisionSchema = z.object({
  id: z.string().uuid(),
  proposal_id: z.string().uuid(),
  proposal_version_id: z.string().uuid(),
  proposal_digest: z.string(),
  decision: z.string(),
  reason: z.string().nullable(),
  instructions: z.string().nullable(),
  snoozed_until: z.string().nullable(),
  decided_at: z.string(),
});

const PROPOSAL_COLUMNS =
  "id,source_kind,source_id,state,current_version_id,linked_campaign_id,snoozed_until,created_at,updated_at";
const VERSION_COLUMNS = "id,proposal_id,version,document,digest,created_at";
const DECISION_COLUMNS =
  "id,proposal_id,proposal_version_id,proposal_digest,decision,reason,instructions,snoozed_until,decided_at";

/** How many proposals one surface reads. Bounded, like every other lane. */
export const PROPOSAL_PAGE_SIZE = 25;

function toProposalRow(row: z.infer<typeof proposalSchema>): ProposalRow {
  return {
    id: row.id,
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    state: row.state,
    currentVersionId: row.current_version_id,
    linkedCampaignId: row.linked_campaign_id,
    snoozedUntil: row.snoozed_until,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toVersionRow(row: z.infer<typeof versionSchema>): ProposalVersionRow {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    version: row.version,
    document: row.document,
    digest: row.digest,
    createdAt: row.created_at,
  };
}

function toDecisionRow(row: z.infer<typeof decisionSchema>): ProposalDecisionRow {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    proposalVersionId: row.proposal_version_id,
    proposalDigest: row.proposal_digest,
    decision: row.decision,
    reason: row.reason,
    instructions: row.instructions,
    snoozedUntil: row.snoozed_until,
    decidedAt: row.decided_at,
  };
}

export type ProposalBundle = {
  proposal: ProposalRow;
  version: ProposalVersionRow | null;
  decisions: readonly ProposalDecisionRow[];
};

export type CampaignProposalReader = {
  listProposals(input: {
    organizationId: string;
    limit?: number;
  }): Promise<readonly ProposalBundle[]>;
  readProposal(input: {
    organizationId: string;
    proposalId: string;
  }): Promise<ProposalBundle | null>;
};

/**
 * Reads on the caller's own session client.
 *
 * Never a service role. A member must see exactly the proposals their
 * organization membership admits, and the approval that follows a read is a
 * person agreeing to spend their own money — there is no version of that which
 * a background identity should be able to look at on their behalf.
 */
export function createCampaignProposalReader(
  client: ProposalReadPersistence,
): CampaignProposalReader {
  async function readVersions(
    organizationId: string,
    versionIds: readonly string[],
  ): Promise<Map<string, ProposalVersionRow>> {
    if (versionIds.length === 0) return new Map();

    const { data, error } = await client
      .from("campaign_proposal_versions")
      .select(VERSION_COLUMNS)
      .eq("organization_id", organizationId)
      .in("id", versionIds);
    if (error) throw new Error("Campaign proposal versions could not be read.");

    const parsed = z.array(versionSchema).safeParse(data ?? []);
    if (!parsed.success) throw new Error("A campaign proposal version row was unreadable.");

    return new Map(parsed.data.map((row) => [row.id, toVersionRow(row)]));
  }

  async function readDecisions(
    organizationId: string,
    proposalIds: readonly string[],
  ): Promise<Map<string, ProposalDecisionRow[]>> {
    if (proposalIds.length === 0) return new Map();

    const { data, error } = await client
      .from("campaign_proposal_decisions")
      .select(DECISION_COLUMNS)
      .eq("organization_id", organizationId)
      .in("proposal_id", proposalIds)
      .order("decided_at", { ascending: false });
    if (error) throw new Error("Campaign proposal decisions could not be read.");

    const parsed = z.array(decisionSchema).safeParse(data ?? []);
    if (!parsed.success) throw new Error("A campaign proposal decision row was unreadable.");

    const byProposal = new Map<string, ProposalDecisionRow[]>();
    for (const row of parsed.data) {
      const existing = byProposal.get(row.proposal_id);
      if (existing) existing.push(toDecisionRow(row));
      else byProposal.set(row.proposal_id, [toDecisionRow(row)]);
    }
    return byProposal;
  }

  return {
    async listProposals(input) {
      const { data, error } = await client
        .from("campaign_proposals")
        .select(PROPOSAL_COLUMNS)
        .eq("organization_id", input.organizationId)
        .order("updated_at", { ascending: false })
        .limit(input.limit ?? PROPOSAL_PAGE_SIZE);
      if (error) throw new Error("Campaign proposals could not be read.");

      const parsed = z.array(proposalSchema).safeParse(data ?? []);
      if (!parsed.success) throw new Error("A campaign proposal row was unreadable.");

      const proposals = parsed.data.map(toProposalRow);
      const versionIds = proposals
        .map((proposal) => proposal.currentVersionId)
        .filter((id): id is string => id !== null);

      const [versions, decisions] = await Promise.all([
        readVersions(input.organizationId, versionIds),
        readDecisions(
          input.organizationId,
          proposals.map((proposal) => proposal.id),
        ),
      ]);

      return proposals.map((proposal) => ({
        proposal,
        version:
          proposal.currentVersionId === null
            ? null
            : // A pointer with no readable row behind it is absence, not a
              // half-proposal. The read model turns that into "being
              // researched", which is what it looks like from outside.
              (versions.get(proposal.currentVersionId) ?? null),
        decisions: decisions.get(proposal.id) ?? [],
      }));
    },

    async readProposal(input) {
      const { data, error } = await client
        .from("campaign_proposals")
        .select(PROPOSAL_COLUMNS)
        .eq("organization_id", input.organizationId)
        .eq("id", input.proposalId)
        .limit(1);
      if (error) throw new Error("The campaign proposal could not be read.");

      const parsed = z.array(proposalSchema).safeParse(data ?? []);
      if (!parsed.success) throw new Error("A campaign proposal row was unreadable.");

      const [row] = parsed.data;
      // Not yours and not there answer identically here, as they do on the
      // decision route: distinguishing them is how somebody enumerates another
      // client's proposals.
      if (!row) return null;

      const proposal = toProposalRow(row);
      const [versions, decisions] = await Promise.all([
        readVersions(
          input.organizationId,
          proposal.currentVersionId === null ? [] : [proposal.currentVersionId],
        ),
        readDecisions(input.organizationId, [proposal.id]),
      ]);

      return {
        proposal,
        version:
          proposal.currentVersionId === null
            ? null
            : (versions.get(proposal.currentVersionId) ?? null),
        decisions: decisions.get(proposal.id) ?? [],
      };
    },
  };
}
