import { describe, expect, it, vi } from "vitest";

import {
  createLaunchRepository,
  launchFailure,
  readLaunchAuthorized,
  type LaunchAuthorityReader,
  type LaunchPersistence,
} from "@/modules/campaigns/infrastructure/launch-repository";

const ORGANIZATION = "11111111-1111-4111-8111-111111111111";
const DELIVERABLE = "22222222-2222-4222-8222-222222222222";
const VERSION = "33333333-3333-4333-8333-333333333333";
const HASH = "a".repeat(64);

type TableResult = { data: unknown; error: { message?: string } | null };

/**
 * A client that answers each table from a fixed map, and records what it was
 * asked for. Enough to prove the read shape without pretending to be Postgres.
 */
function client(
  tables: Record<string, TableResult>,
  rpc: () => Promise<{ data: unknown; error: { code?: string; message?: string } | null }> = () =>
    Promise.resolve({ data: {}, error: null }),
) {
  const calls: { table: string; column: string; values: readonly string[] }[] = [];

  const persistence = {
    rpc: vi.fn(rpc),
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              return {
                in(column: string, values: readonly string[]) {
                  calls.push({ table, column, values });
                  return Promise.resolve(tables[table] ?? { data: [], error: null });
                },
              };
            },
          };
        },
      };
    },
  };

  return { persistence: persistence as unknown as LaunchPersistence, calls, rpc: persistence.rpc };
}

function versionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: VERSION,
    content_hash: HASH,
    version: 2,
    deliverable_id: DELIVERABLE,
    ...overrides,
  };
}

function reviewRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    organization_id: ORGANIZATION,
    deliverable_id: DELIVERABLE,
    deliverable_version_id: VERSION,
    content_hash: HASH,
    actor_id: "55555555-5555-4555-8555-555555555555",
    decision: "approved",
    reason_codes: [],
    note: null,
    reviewed_at: "2026-09-13T10:00:00.000Z",
    ...overrides,
  };
}

function tables(overrides: Partial<Record<string, TableResult>> = {}) {
  return {
    campaign_deliverable_versions: { data: [versionRow()], error: null },
    campaign_deliverables: {
      data: [{ id: DELIVERABLE, current_version_id: VERSION }],
      error: null,
    },
    campaign_deliverable_reviews: { data: [reviewRow()], error: null },
    ...overrides,
  } as Record<string, TableResult>;
}

describe("reading the review state", () => {
  it("reads every selection in one query per table, not one per output", async () => {
    const second = "66666666-6666-4666-8666-666666666666";
    const { persistence, calls } = client(
      tables({
        campaign_deliverable_versions: {
          data: [versionRow(), versionRow({ id: second })],
          error: null,
        },
      }),
    );

    await createLaunchRepository(persistence).readReviewState({
      organizationId: ORGANIZATION,
      deliverableVersionIds: [VERSION, second],
    });

    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({
      table: "campaign_deliverable_versions",
      values: [VERSION, second],
    });
  });

  it("does not query at all for an empty selection", async () => {
    const { persistence, calls } = client(tables());

    const state = await createLaunchRepository(persistence).readReviewState({
      organizationId: ORGANIZATION,
      deliverableVersionIds: [],
    });

    expect(state.size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("treats a version that is its deliverable's current one as current", async () => {
    const { persistence } = client(tables());

    const state = await createLaunchRepository(persistence).readReviewState({
      organizationId: ORGANIZATION,
      deliverableVersionIds: [VERSION],
    });

    expect(state.get(VERSION)).toMatchObject({ currentVersion: 2 });
  });

  it("fails closed when a newer version has taken over", async () => {
    const { persistence } = client(
      tables({
        campaign_deliverables: {
          data: [{ id: DELIVERABLE, current_version_id: "77777777-7777-4777-8777-777777777777" }],
          error: null,
        },
      }),
    );

    const state = await createLaunchRepository(persistence).readReviewState({
      organizationId: ORGANIZATION,
      deliverableVersionIds: [VERSION],
    });

    // Reported as behind the current version, so the domain refuses rather than
    // assuming this one is still the live output.
    expect(state.get(VERSION)).toMatchObject({ version: { version: 2 }, currentVersion: 3 });
  });

  it("fails closed when the deliverable row cannot be seen at all", async () => {
    const { persistence } = client(
      tables({ campaign_deliverables: { data: [], error: null } }),
    );

    const state = await createLaunchRepository(persistence).readReviewState({
      organizationId: ORGANIZATION,
      deliverableVersionIds: [VERSION],
    });

    expect(state.get(VERSION)).toMatchObject({ currentVersion: 3 });
  });

  it("drops a stored review that no longer satisfies the schema", async () => {
    const { persistence } = client(
      tables({
        campaign_deliverable_reviews: {
          data: [reviewRow(), reviewRow({ id: "not-a-uuid" })],
          error: null,
        },
      }),
    );

    const state = await createLaunchRepository(persistence).readReviewState({
      organizationId: ORGANIZATION,
      deliverableVersionIds: [VERSION],
    });

    // A malformed review must not be able to authorize a publication.
    expect(state.get(VERSION)?.reviews).toHaveLength(1);
  });

  it("raises rather than reporting a failed read as 'nothing was reviewed'", async () => {
    const { persistence } = client(
      tables({
        campaign_deliverable_reviews: { data: null, error: { message: "connection reset" } },
      }),
    );

    // An empty map would read as a confident refusal. It must not be one.
    await expect(
      createLaunchRepository(persistence).readReviewState({
        organizationId: ORGANIZATION,
        deliverableVersionIds: [VERSION],
      }),
    ).rejects.toMatchObject({ kind: "unavailable" });
  });
});

describe("committing the authority", () => {
  it("sends no actor, because the database reads the session for one", async () => {
    const { persistence, rpc } = client(tables(), () =>
      Promise.resolve({ data: { launch_approval_id: "approval", outcome: "saved" }, error: null }),
    );

    await createLaunchRepository(persistence).approveLaunch({
      organizationId: ORGANIZATION,
      payload: { campaign_id: "campaign" },
    });

    const args = (rpc.mock.calls as unknown as unknown[][])[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(args)).toEqual(["target_organization_id", "input_launch"]);
    expect(JSON.stringify(args)).not.toContain("actor");
  });

  it("reports a replay as a replay", async () => {
    const { persistence } = client(tables(), () =>
      Promise.resolve({
        data: { launch_approval_id: "approval", outcome: "replayed" },
        error: null,
      }),
    );

    await expect(
      createLaunchRepository(persistence).approveLaunch({
        organizationId: ORGANIZATION,
        payload: {},
      }),
    ).resolves.toMatchObject({ outcome: "replayed" });
  });
});

describe("translating a refusal", () => {
  it.each([
    ["campaign_launch_selection_unreviewed", "selection_not_reviewed"],
    ["campaign_launch_selection_rejected", "selection_rejected"],
    ["campaign_launch_selection_superseded", "selection_superseded"],
    ["campaign_launch_content_changed", "selection_content_changed"],
  ])("reports %s as the specific output problem it is", (raised, reasonCode) => {
    expect(launchFailure({ message: raised, code: "22023" })).toEqual({
      kind: "not_admissible",
      reasonCode,
    });
  });

  it("answers a foreign-campaign selection the same way as a missing one", () => {
    expect(launchFailure({ message: "campaign_launch_selection_foreign_campaign" })).toEqual(
      launchFailure({ message: "campaign_launch_selection_not_found" }),
    );
  });

  it("reports a permission refusal as forbidden", () => {
    expect(launchFailure({ message: "campaign_launch_forbidden", code: "42501" })).toEqual({
      kind: "forbidden",
    });
  });

  it("reports the same key with different terms as a conflict", () => {
    expect(
      launchFailure({ message: "campaign_launch_idempotency_conflict", code: "23505" }),
    ).toEqual({ kind: "conflict" });
  });

  it("treats an unrecognised refusal as unavailable rather than guessing at it", () => {
    // Reporting a refusal we do not understand as a specific business outcome
    // would be a confident lie.
    expect(launchFailure({ message: "something new", code: "XX000" })).toEqual({
      kind: "unavailable",
    });
  });
});

describe("whether a publication is authorized", () => {
  function authorityClient(result: { data: unknown[] | null; error: unknown }) {
    const seen: { column: string; value: string }[] = [];
    const client = {
      from() {
        return {
          select: () => ({
            eq: (c1: string, v1: string) => {
              seen.push({ column: c1, value: v1 });
              return {
                eq: (c2: string, v2: string) => {
                  seen.push({ column: c2, value: v2 });
                  return {
                    eq: (c3: string, v3: string) => {
                      seen.push({ column: c3, value: v3 });
                      return Promise.resolve(result);
                    },
                  };
                },
              };
            },
          }),
        };
      },
    };
    return { client: client as unknown as LaunchAuthorityReader, seen };
  }

  it("counts only a live authority, never a superseded or revoked one", async () => {
    const { client, seen } = authorityClient({ data: [{ id: "a" }], error: null });

    await expect(
      readLaunchAuthorized(client, { organizationId: ORGANIZATION, campaignId: "campaign" }),
    ).resolves.toBe(true);

    // Superseded rows record what was once permitted and permit nothing now.
    expect(seen).toContainEqual({ column: "state", value: "authorized" });
  });

  it("answers false when nothing authorizes a publication", async () => {
    const { client } = authorityClient({ data: [], error: null });

    await expect(
      readLaunchAuthorized(client, { organizationId: ORGANIZATION, campaignId: "campaign" }),
    ).resolves.toBe(false);
  });

  it("answers 'unknown' when the read failed, never 'not authorized'", async () => {
    // Reporting a failed read as "not authorized" would send somebody to
    // re-authorize something that may already be authorized.
    const { client } = authorityClient({ data: null, error: { message: "connection reset" } });

    await expect(
      readLaunchAuthorized(client, { organizationId: ORGANIZATION, campaignId: "campaign" }),
    ).resolves.toBeNull();
  });

  it("answers 'unknown' rather than throwing into the page render", async () => {
    const throwing = {
      from() {
        throw new Error("offline");
      },
    } as unknown as LaunchAuthorityReader;

    await expect(
      readLaunchAuthorized(throwing, { organizationId: ORGANIZATION, campaignId: "campaign" }),
    ).resolves.toBeNull();
  });
});
