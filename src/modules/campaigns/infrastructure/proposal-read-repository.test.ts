import { describe, expect, it } from "vitest";

import {
  createCampaignProposalReader,
  type ProposalReadPersistence,
} from "@/modules/campaigns/infrastructure/proposal-read-repository";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const PROPOSAL_A = "a0000000-0000-4000-8000-00000000000a";
const PROPOSAL_B = "a0000000-0000-4000-8000-00000000000b";
const VERSION_A = "b0000000-0000-4000-8000-00000000000a";
const VERSION_B = "b0000000-0000-4000-8000-00000000000b";
const DECISION_A = "c0000000-0000-4000-8000-00000000000a";

type Row = Record<string, unknown>;

function persistence(options: { tables?: Record<string, Row[]>; tableError?: string }) {
  const filters: { table: string; column: string; value: unknown }[] = [];
  const reads: string[] = [];

  const client: ProposalReadPersistence = {
    from(table) {
      reads.push(table);
      const result = options.tableError
        ? { data: null, error: { message: options.tableError } }
        : { data: options.tables?.[table] ?? [], error: null };
      const chain = {
        eq(column: string, value: string) {
          filters.push({ table, column, value });
          return chain;
        },
        in(column: string, value: readonly string[]) {
          filters.push({ table, column, value });
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        then(resolve: (value: typeof result) => unknown) {
          return Promise.resolve(result).then(resolve);
        },
      };
      return { select: () => chain } as unknown as ReturnType<ProposalReadPersistence["from"]>;
    },
  };

  return { client, filters, reads };
}

function proposalRow(overrides: Row = {}): Row {
  return {
    id: PROPOSAL_A,
    source_kind: "business_signal",
    source_id: null,
    state: "ready_for_review",
    current_version_id: VERSION_A,
    linked_campaign_id: null,
    snoozed_until: null,
    created_at: "2026-09-14T08:00:00.000Z",
    updated_at: "2026-09-15T08:00:00.000Z",
    ...overrides,
  };
}

function versionRow(overrides: Row = {}): Row {
  return {
    id: VERSION_A,
    proposal_id: PROPOSAL_A,
    version: 1,
    document: { schemaVersion: 1, title: "Weekday lunch footfall" },
    digest: "f".repeat(64),
    created_at: "2026-09-15T07:00:00.000Z",
    ...overrides,
  };
}

function decisionRow(overrides: Row = {}): Row {
  return {
    id: DECISION_A,
    proposal_id: PROPOSAL_A,
    proposal_version_id: VERSION_A,
    proposal_digest: "f".repeat(64),
    decision: "changes_requested",
    reason: null,
    instructions: "Say what the offer is.",
    snoozed_until: null,
    decided_at: "2026-09-15T09:00:00.000Z",
    ...overrides,
  };
}

describe("reading campaign proposals back out", () => {
  it("scopes every read to the organization", async () => {
    const { client, filters } = persistence({
      tables: {
        campaign_proposals: [proposalRow()],
        campaign_proposal_versions: [versionRow()],
        campaign_proposal_decisions: [decisionRow()],
      },
    });

    await createCampaignProposalReader(client).listProposals({ organizationId: ORGANIZATION_ID });

    // Row level security is the fence; this predicate is belt as well as
    // braces. A read that omitted it would be relying on RLS alone to do
    // something the query should have said.
    for (const table of [
      "campaign_proposals",
      "campaign_proposal_versions",
      "campaign_proposal_decisions",
    ]) {
      expect(filters).toEqual(
        expect.arrayContaining([
          { table, column: "organization_id", value: ORGANIZATION_ID },
        ]),
      );
    }
  });

  it("matches versions and decisions to their proposals in memory", async () => {
    const { client } = persistence({
      tables: {
        campaign_proposals: [
          proposalRow(),
          proposalRow({ id: PROPOSAL_B, current_version_id: VERSION_B }),
        ],
        campaign_proposal_versions: [
          versionRow(),
          versionRow({ id: VERSION_B, proposal_id: PROPOSAL_B, version: 2 }),
        ],
        campaign_proposal_decisions: [decisionRow()],
      },
    });

    const bundles = await createCampaignProposalReader(client).listProposals({
      organizationId: ORGANIZATION_ID,
    });

    expect(bundles).toHaveLength(2);
    expect(bundles[0]?.version?.version).toBe(1);
    expect(bundles[0]?.decisions).toHaveLength(1);
    // The second proposal has a version but no decision, and an empty list is
    // not the same fact as a missing one.
    expect(bundles[1]?.version?.version).toBe(2);
    expect(bundles[1]?.decisions).toEqual([]);
  });

  it("does not ask for versions when no proposal has one", async () => {
    const { client, reads } = persistence({
      tables: {
        campaign_proposals: [proposalRow({ state: "researching", current_version_id: null })],
      },
    });

    const bundles = await createCampaignProposalReader(client).listProposals({
      organizationId: ORGANIZATION_ID,
    });

    expect(bundles[0]?.version).toBeNull();
    expect(reads).not.toContain("campaign_proposal_versions");
  });

  it("reports a version pointer with nothing behind it as absent", async () => {
    // Not a half-proposal: the read model turns this into "being researched",
    // which is what it looks like from outside.
    const { client } = persistence({
      tables: {
        campaign_proposals: [proposalRow()],
        campaign_proposal_versions: [],
      },
    });

    const bundles = await createCampaignProposalReader(client).listProposals({
      organizationId: ORGANIZATION_ID,
    });

    expect(bundles[0]?.version).toBeNull();
  });

  it("leaves the stored document untouched for the read model to judge", async () => {
    const { client } = persistence({
      tables: {
        campaign_proposals: [proposalRow()],
        campaign_proposal_versions: [versionRow({ document: { anything: "at all" } })],
      },
    });

    const bundles = await createCampaignProposalReader(client).listProposals({
      organizationId: ORGANIZATION_ID,
    });

    // Parsing here would make one unreadable document fail the whole page.
    // The read model reports it as unreadable instead.
    expect(bundles[0]?.version?.document).toEqual({ anything: "at all" });
  });

  it("answers a missing proposal and somebody else's identically", async () => {
    const { client } = persistence({ tables: { campaign_proposals: [] } });

    expect(
      await createCampaignProposalReader(client).readProposal({
        organizationId: ORGANIZATION_ID,
        proposalId: PROPOSAL_A,
      }),
    ).toBeNull();
  });

  it("filters a single read by both the organization and the proposal", async () => {
    const { client, filters } = persistence({
      tables: {
        campaign_proposals: [proposalRow()],
        campaign_proposal_versions: [versionRow()],
        campaign_proposal_decisions: [decisionRow()],
      },
    });

    const bundle = await createCampaignProposalReader(client).readProposal({
      organizationId: ORGANIZATION_ID,
      proposalId: PROPOSAL_A,
    });

    expect(bundle?.proposal.id).toBe(PROPOSAL_A);
    expect(filters).toEqual(
      expect.arrayContaining([
        { table: "campaign_proposals", column: "organization_id", value: ORGANIZATION_ID },
        { table: "campaign_proposals", column: "id", value: PROPOSAL_A },
      ]),
    );
  });

  it("raises rather than reporting an unreadable table as no proposals", async () => {
    const { client } = persistence({ tableError: "permission denied" });

    // An empty list and a failed read must never look the same: one says
    // nothing is proposed, the other says nobody knows.
    await expect(
      createCampaignProposalReader(client).listProposals({ organizationId: ORGANIZATION_ID }),
    ).rejects.toThrow(/could not be read/i);
  });

  it("raises when a proposal row is not the shape it must be", async () => {
    const { client } = persistence({
      tables: { campaign_proposals: [{ id: PROPOSAL_A, state: "ready_for_review" }] },
    });

    await expect(
      createCampaignProposalReader(client).listProposals({ organizationId: ORGANIZATION_ID }),
    ).rejects.toThrow(/unreadable/i);
  });
});
