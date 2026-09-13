import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createAuthenticatedResearchProjectRepository } from "@/modules/growth-intelligence/infrastructure/research-project-repository";

const organizationId = "10000000-0000-4000-8000-000000000001";
const otherOrganizationId = "10000000-0000-4000-8000-000000000099";
const branchId = "20000000-0000-4000-8000-000000000002";
const projectId = "30000000-0000-4000-8000-000000000003";
const revisionId = "40000000-0000-4000-8000-000000000004";
const reportId = "50000000-0000-4000-8000-000000000005";
const reportVersionId = "60000000-0000-4000-8000-000000000006";
const claimId = "70000000-0000-4000-8000-000000000007";
const snapshotId = "80000000-0000-4000-8000-000000000008";
const actorId = "00000000-0000-4000-8000-000000000010";

type QueryResult = { data: unknown; error: unknown };

function persistence(results: Record<string, QueryResult[]> = {}) {
  const queues = new Map(Object.entries(results).map(([table, rows]) => [table, [...rows]]));
  const calls: Array<{ table: string; filters: Array<[string, unknown]>; select?: string }> = [];
  const from = vi.fn((table: string) => {
    const result = queues.get(table)?.shift() ?? { data: [], error: null };
    const call: { table: string; filters: Array<[string, unknown]>; select?: string } = {
      table,
      filters: [],
    };
    calls.push(call);
    const builder = {
      select: vi.fn((columns: string) => {
        call.select = columns;
        return builder;
      }),
      eq: vi.fn((key: string, value: unknown) => {
        call.filters.push([key, value]);
        return builder;
      }),
      in: vi.fn((key: string, value: unknown) => {
        call.filters.push([key, value]);
        return builder;
      }),
      or: vi.fn((value: unknown) => {
        call.filters.push(["or", value]);
        return builder;
      }),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => result),
      single: vi.fn(async () => result),
      then: (resolve: (value: QueryResult) => unknown) => Promise.resolve(result).then(resolve),
    };
    return builder;
  });
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    const result = queues.get(`rpc:${name}`)?.shift() ?? { data: null, error: null };
    return result;
  });
  return { client: { from, rpc } as never, calls, rpcCalls };
}

function briefDocument(overrides: Record<string, unknown> = {}) {
  return {
    revisionId,
    projectId,
    organizationId,
    revisionNumber: 1,
    question: "What do Marina families want for Friday dinner?",
    locationId: branchId,
    researchArea: "Family dining",
    competitors: [],
    investigationAreas: ["demand"],
    evidencePeriods: [],
    businessContextSnapshotId: snapshotId,
    frequency: "once",
    pinnedToUpdateId: null,
    createdAtUtc: "2026-09-13T10:00:00.000Z",
    ...overrides,
  };
}

function reportContent(overrides: Record<string, unknown> = {}) {
  return {
    reportId,
    reportVersionId,
    organizationId,
    projectId,
    locationId: branchId,
    briefRevisionId: revisionId,
    evidenceDigest: "digest-one",
    summary: "Marina families book early for Friday dinner.",
    localMeaning: "An early-bird family offer fits the Marina week.",
    findings: [
      {
        key: "early-booking",
        statement: "Rival listings show Friday slots filling by Thursday.",
        citationSlots: [{ claimId, sourceRef: "src-one" }],
      },
    ],
    competitorComparison: [
      { competitorName: "Marina Rival", summary: "Rival pushes Friday family platters." },
    ],
    sources: [{ sourceRef: "src-one" }],
    ...overrides,
  };
}

describe("createProject", () => {
  it("wires the governed create RPC with server-owned scope for one-time projects", async () => {
    const { client, rpcCalls } = persistence({
      "rpc:create_research_project": [
        { data: { projectId, lifecycle: "active", replayed: false }, error: null },
      ],
    });
    const repository = createAuthenticatedResearchProjectRepository(client);

    const outcome = await repository.createProject({
      organizationId,
      branchId,
      title: "Marina Friday dinner",
      question: "What do Marina families want for Friday dinner?",
      mode: "one-time",
      actorId,
    });

    expect(outcome).toEqual({ projectId, lifecycle: "active", replayed: false });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toEqual({
      name: "create_research_project",
      args: {
        p_organization_id: organizationId,
        p_actor_id: actorId,
        p_branch_id: branchId,
        p_title: "Marina Friday dinner",
        p_question: "What do Marina families want for Friday dinner?",
        p_mode: "one-time",
        p_schedule: null,
      },
    });
  });

  it("refuses a one-time project carrying a schedule before any tenant call", async () => {
    const { client, rpcCalls } = persistence({});
    const repository = createAuthenticatedResearchProjectRepository(client);

    await expect(
      repository.createProject({
        organizationId,
        branchId,
        title: "Scheduled once",
        question: "A one-time project carrying a schedule.",
        mode: "one-time",
        schedule: { cadence: "weekly", localTime: "07:00", timeZone: "Asia/Dubai" },
        actorId,
      }),
    ).rejects.toThrow();
    expect(rpcCalls).toEqual([]);
  });

  it("refuses a recurring project without a schedule before any tenant call", async () => {
    const { client, rpcCalls } = persistence({});
    const repository = createAuthenticatedResearchProjectRepository(client);

    await expect(
      repository.createProject({
        organizationId,
        branchId,
        title: "Headless weekly",
        question: "A weekly project with no schedule.",
        mode: "recurring",
        actorId,
      }),
    ).rejects.toThrow();
    expect(rpcCalls).toEqual([]);
  });
});

describe("saveBriefRevision", () => {
  it("wires the governed save RPC with the pinned document", async () => {
    const { client, rpcCalls } = persistence({
      "rpc:save_brief_revision": [
        { data: { revisionId, projectId, revisionNumber: 1, replayed: false }, error: null },
      ],
    });
    const repository = createAuthenticatedResearchProjectRepository(client);

    const outcome = await repository.saveBriefRevision({
      organizationId,
      projectId,
      revisionNumber: 1,
      document: briefDocument(),
      pinnedToUpdateId: null,
      actorId,
    });

    expect(outcome).toEqual({ revisionId, revisionNumber: 1, replayed: false });
    expect(rpcCalls[0]?.name).toBe("save_brief_revision");
    expect(rpcCalls[0]?.args).toMatchObject({
      p_organization_id: organizationId,
      p_project_id: projectId,
      p_revision_number: 1,
      p_pinned_to_update_id: null,
    });
  });

  it("refuses a document naming another organization before any tenant call", async () => {
    const { client, rpcCalls } = persistence({});
    const repository = createAuthenticatedResearchProjectRepository(client);

    await expect(
      repository.saveBriefRevision({
        organizationId,
        projectId,
        revisionNumber: 1,
        document: briefDocument({ organizationId: otherOrganizationId }),
        pinnedToUpdateId: null,
        actorId,
      }),
    ).rejects.toThrow(/could not be understood/);
    expect(rpcCalls).toEqual([]);
  });

  it("maps a pinned-revision conflict to a safe domain outcome", async () => {
    const { client } = persistence({
      "rpc:save_brief_revision": [
        { data: null, error: { message: "brief_revision_pinned" } },
      ],
    });
    const repository = createAuthenticatedResearchProjectRepository(client);

    await expect(
      repository.saveBriefRevision({
        organizationId,
        projectId,
        revisionNumber: 2,
        document: briefDocument({ revisionNumber: 2 }),
        pinnedToUpdateId: null,
        actorId,
      }),
    ).rejects.toThrow(/already saved/);
  });
});

describe("persistReportVersion", () => {
  it("wires the governed persist RPC with the pinned content", async () => {
    const { client, rpcCalls } = persistence({
      "rpc:persist_report_version": [
        {
          data: {
            reportId,
            reportVersionId,
            reviewState: "pending_review",
            draftItemCount: 2,
            replayed: false,
          },
          error: null,
        },
      ],
    });
    const repository = createAuthenticatedResearchProjectRepository(client);

    const outcome = await repository.persistReportVersion({
      organizationId,
      projectId,
      branchId,
      briefRevisionId: revisionId,
      reportVersionId,
      evidenceDigest: "digest-one",
      content: reportContent(),
      actorId,
    });

    expect(outcome).toEqual({
      reportId,
      reportVersionId,
      reviewState: "pending_review",
      draftItemCount: 2,
      replayed: false,
    });
    expect(rpcCalls[0]).toMatchObject({
      name: "persist_report_version",
      args: expect.objectContaining({
        p_organization_id: organizationId,
        p_report_version_id: reportVersionId,
        p_evidence_digest: "digest-one",
      }),
    });
  });

  it("maps a changed-content version conflict without leaking evidence state", async () => {
    const { client } = persistence({
      "rpc:persist_report_version": [
        { data: null, error: { message: "monitoring_report_version_conflict" } },
      ],
    });
    const repository = createAuthenticatedResearchProjectRepository(client);

    await expect(
      repository.persistReportVersion({
        organizationId,
        projectId,
        branchId,
        briefRevisionId: revisionId,
        reportVersionId,
        evidenceDigest: "digest-changed",
        content: reportContent({ evidenceDigest: "digest-changed" }),
        actorId,
      }),
    ).rejects.toThrow(/already saved/);
  });
});

describe("acceptDraftItem", () => {
  const input = {
    organizationId,
    reportVersionId,
    itemKey: "fix-queues",
    kind: "action" as const,
    actorId,
  };

  it("wires the governed accept RPC and returns the routed outcome", async () => {
    const { client, rpcCalls } = persistence({
      "rpc:accept_draft_item": [
        {
          data: {
            acceptanceKey: `${reportVersionId}:fix-queues`,
            destination: "Recommendations",
            grantsExecutionApproval: false,
            outcome: "accepted",
          },
          error: null,
        },
      ],
    });
    const repository = createAuthenticatedResearchProjectRepository(client);

    const outcome = await repository.acceptDraftItem(input);

    expect(outcome).toEqual({
      acceptanceKey: `${reportVersionId}:fix-queues`,
      destination: "Recommendations",
      outcome: "accepted",
    });
    expect(rpcCalls).toEqual([
      {
        name: "accept_draft_item",
        args: {
          p_organization_id: organizationId,
          p_actor_id: actorId,
          p_report_version_id: reportVersionId,
          p_item_key: "fix-queues",
          p_kind: "action",
        },
      },
    ]);
  });

  it("maps a kind mismatch to a conflict without overwriting", async () => {
    const { client } = persistence({
      "rpc:accept_draft_item": [
        { data: null, error: { message: "draft_acceptance_kind_conflict" } },
      ],
    });
    const repository = createAuthenticatedResearchProjectRepository(client);

    await expect(repository.acceptDraftItem(input)).rejects.toThrow(/already saved/);
  });

  it("maps a forbidden acceptance to an authorization outcome", async () => {
    const { client } = persistence({
      "rpc:accept_draft_item": [
        { data: null, error: { message: "draft_acceptance_forbidden" } },
      ],
    });
    const repository = createAuthenticatedResearchProjectRepository(client);

    await expect(repository.acceptDraftItem(input)).rejects.toThrow(/permission/);
  });
});

describe("bounded reads", () => {
  function projectRow(overrides: Record<string, unknown> = {}) {
    return {
      id: projectId,
      organization_id: organizationId,
      branch_id: branchId,
      title: "Marina Friday dinner",
      question: "What do Marina families want for Friday dinner?",
      mode: "one-time",
      schedule: null,
      lifecycle: "active",
      created_at: "2026-09-13T10:00:00.000Z",
      updated_at: "2026-09-13T10:00:00.000Z",
      ...overrides,
    };
  }

  function reportRow(overrides: Record<string, unknown> = {}) {
    return {
      id: reportId,
      organization_id: organizationId,
      project_id: projectId,
      branch_id: branchId,
      brief_revision_id: revisionId,
      report_version_id: reportVersionId,
      evidence_digest: "digest-one",
      content: reportContent(),
      review_state: "pending_review",
      created_at: "2026-09-13T11:00:00.000Z",
      ...overrides,
    };
  }

  it("lists active projects scoped to the organization with a clamped page", async () => {
    const { client, calls } = persistence({
      growth_intelligence_research_projects: [{ data: [projectRow()], error: null }],
    });
    const repository = createAuthenticatedResearchProjectRepository(client);

    const projects = await repository.listActiveProjects({
      organizationId,
      branchId,
      limit: 500,
    });

    expect(projects).toHaveLength(1);
    expect(projects[0]?.projectId).toBe(projectId);
    const call = calls.find(
      (entry) => entry.table === "growth_intelligence_research_projects",
    );
    expect(call?.filters).toContainEqual(["organization_id", organizationId]);
    expect(call?.filters).toContainEqual(["branch_id", branchId]);
    expect(call?.filters).toContainEqual(["lifecycle", ["active", "paused"]]);
  });

  it("lists one project's brief history scoped to organization and project", async () => {
    const { client, calls } = persistence({
      growth_intelligence_brief_revisions: [
        {
          data: [
            {
              id: revisionId,
              organization_id: organizationId,
              project_id: projectId,
              revision_number: 1,
              document: briefDocument(),
              pinned_to_update_id: null,
              created_at: "2026-09-13T10:00:00.000Z",
            },
          ],
          error: null,
        },
      ],
    });
    const repository = createAuthenticatedResearchProjectRepository(client);

    const revisions = await repository.listBriefRevisions({ organizationId, projectId });

    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.revisionNumber).toBe(1);
    const call = calls.find(
      (entry) => entry.table === "growth_intelligence_brief_revisions",
    );
    expect(call?.filters).toContainEqual(["organization_id", organizationId]);
    expect(call?.filters).toContainEqual(["project_id", projectId]);
  });

  it("rejects a malformed report-history cursor without a tenant read", async () => {
    const { client, calls } = persistence({});
    const repository = createAuthenticatedResearchProjectRepository(client);

    await expect(
      repository.listProjectReports({ organizationId, projectId, cursor: "nope" }),
    ).rejects.toThrow(/cursor/);
    expect(calls).toEqual([]);
  });

  it("pages report history one project at a time with the keyset cursor", async () => {
    const { client, calls } = persistence({
      growth_intelligence_reports: [{ data: [reportRow()], error: null }],
    });
    const repository = createAuthenticatedResearchProjectRepository(client);

    const history = await repository.listProjectReports({ organizationId, projectId });

    expect(history.reports).toHaveLength(1);
    expect(history.reports[0]?.reviewState).toBe("pending_review");
    expect(history.nextCursor).toBeNull();
    const call = calls.find((entry) => entry.table === "growth_intelligence_reports");
    expect(call?.filters).toContainEqual(["organization_id", organizationId]);
    expect(call?.filters).toContainEqual(["project_id", projectId]);
  });

  it("returns null when RLS hides the report from a foreign tenant", async () => {
    const { client } = persistence({
      growth_intelligence_reports: [{ data: null, error: null }],
    });
    const repository = createAuthenticatedResearchProjectRepository(client);

    await expect(
      repository.readReport({ organizationId, reportVersionId }),
    ).resolves.toBeNull();
  });

  it("reads one report version scoped to organization and version", async () => {
    const { client, calls } = persistence({
      growth_intelligence_reports: [{ data: reportRow(), error: null }],
    });
    const repository = createAuthenticatedResearchProjectRepository(client);

    const report = await repository.readReport({ organizationId, reportVersionId });

    expect(report?.reportVersionId).toBe(reportVersionId);
    const call = calls.find((entry) => entry.table === "growth_intelligence_reports");
    expect(call?.filters).toContainEqual(["organization_id", organizationId]);
    expect(call?.filters).toContainEqual(["report_version_id", reportVersionId]);
  });
});
