import { describe, expect, it, vi } from "vitest";

import { logger } from "@/lib/logger";
import {
  createDeliverableRepository,
  deliverableFailure,
  type DeliverablePersistence,
} from "@/modules/campaigns/infrastructure/deliverable-repository";

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const loggerWarn = vi.mocked(logger.warn);

const ORGANIZATION = "11111111-1111-4111-8111-111111111111";

describe("reading a database refusal", () => {
  it("names each refusal the migration raises", () => {
    expect(deliverableFailure({ message: "campaign_deliverable_superseded" })).toEqual({
      kind: "superseded",
    });
    expect(deliverableFailure({ message: "campaign_deliverable_content_changed" })).toEqual({
      kind: "content_changed",
    });
    expect(deliverableFailure({ message: "campaign_deliverable_forbidden" })).toEqual({
      kind: "forbidden",
    });
  });

  it("falls back to SQLSTATE when the message says nothing recognisable", () => {
    expect(deliverableFailure({ code: "42501", message: "boom" })).toEqual({ kind: "forbidden" });
    expect(deliverableFailure({ code: "23505", message: "boom" })).toEqual({ kind: "conflict" });
  });

  it("reports an unknown refusal as unavailable rather than guessing", () => {
    expect(deliverableFailure({ code: "XX000", message: "new" })).toEqual({ kind: "unavailable" });
  });
});

describe("the review call", () => {
  it("sends no actor, so a forged reviewer has nowhere to land", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { review_id: "r", outcome: "saved" },
      error: null,
    });
    const repository = createDeliverableRepository({
      rpc,
      from: vi.fn(),
    } as unknown as DeliverablePersistence);

    await repository.reviewVersion({
      organizationId: ORGANIZATION,
      payload: { deliverable_version_id: "v", content_hash: "a".repeat(64), decision: "approved" },
    });

    const sent = JSON.stringify(rpc.mock.calls[0]?.[1]);
    expect(sent).not.toContain("actor");
  });

  it("throws the mapped failure instead of returning a half-result", async () => {
    const repository = createDeliverableRepository({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: "22023", message: "campaign_deliverable_content_changed" },
      }),
      from: vi.fn(),
    } as unknown as DeliverablePersistence);

    await expect(
      repository.reviewVersion({
        organizationId: ORGANIZATION,
        payload: { deliverable_version_id: "v" },
      }),
    ).rejects.toEqual({ kind: "content_changed" });
  });
});

const CAMPAIGN = "22222222-2222-4222-8222-222222222222";
const DELIVERABLE = "33333333-3333-4333-8333-333333333333";
const VERSION = "44444444-4444-4444-8444-444444444444";
const HASH = "a".repeat(64);

type TableResult = { data: unknown; error: { message?: string } | null };

/** A client that answers each table from a fixed map. */
function listClient(tables: Record<string, TableResult>) {
  return {
    rpc: vi.fn(),
    from(table: string) {
      const answer = () => Promise.resolve(tables[table] ?? { data: [], error: null });
      return {
        select: () => ({
          eq: () => ({ eq: answer, in: answer }),
        }),
      };
    },
  } as unknown as DeliverablePersistence;
}

function listTables(overrides: Partial<Record<string, TableResult>> = {}) {
  return {
    campaign_deliverables: {
      data: [
        {
          id: DELIVERABLE,
          channel: "instagram",
          placement: "feed",
          language: "en",
          format: "feed",
          ordinal: 1,
          state: "ready_for_review",
          current_version_id: VERSION,
        },
      ],
      error: null,
    },
    campaign_deliverable_versions: {
      data: [
        { id: VERSION, version: 2, content_hash: HASH, created_at: "2026-09-13T10:00:00.000Z" },
      ],
      error: null,
    },
    campaign_deliverable_reviews: { data: [], error: null },
    ...overrides,
  } as Record<string, TableResult>;
}

describe("listing a campaign's outputs", () => {
  it("attaches each deliverable's current version", async () => {
    const listed = await createDeliverableRepository(
      listClient(listTables()),
    ).listForCampaign({ organizationId: ORGANIZATION, campaignId: CAMPAIGN });

    expect(listed).toHaveLength(1);
    expect(listed[0]?.currentVersion).toMatchObject({ id: VERSION, version: 2, contentHash: HASH });
  });

  it("reports a planned-but-unproduced output as having no version", async () => {
    const listed = await createDeliverableRepository(
      listClient(
        listTables({
          campaign_deliverables: {
            data: [
              {
                id: DELIVERABLE,
                channel: "instagram",
                placement: "feed",
                language: "ar",
                format: "feed",
                ordinal: 2,
                state: "preparing",
                current_version_id: null,
              },
            ],
            error: null,
          },
        }),
      ),
    ).listForCampaign({ organizationId: ORGANIZATION, campaignId: CAMPAIGN });

    expect(listed[0]?.currentVersion).toBeNull();
  });

  it("reports a named version it cannot read as absent rather than inventing one", async () => {
    const listed = await createDeliverableRepository(
      listClient(listTables({ campaign_deliverable_versions: { data: [], error: null } })),
    ).listForCampaign({ organizationId: ORGANIZATION, campaignId: CAMPAIGN });

    // Absent means "not produced", which fails closed.
    expect(listed[0]?.currentVersion).toBeNull();
  });

  it("raises rather than showing a failed read as an empty campaign", async () => {
    // "No outputs yet" and "we could not look" are different answers.
    await expect(
      createDeliverableRepository(
        listClient(
          listTables({
            campaign_deliverables: { data: null, error: { message: "connection reset" } },
          }),
        ),
      ).listForCampaign({ organizationId: ORGANIZATION, campaignId: CAMPAIGN }),
    ).rejects.toEqual({ kind: "unavailable" });
  });

  it("drops a stored review that no longer satisfies the schema", async () => {
    const listed = await createDeliverableRepository(
      listClient(
        listTables({
          campaign_deliverable_reviews: {
            data: [{ id: "not-a-uuid", deliverable_version_id: VERSION }],
            error: null,
          },
        }),
      ),
    ).listForCampaign({ organizationId: ORGANIZATION, campaignId: CAMPAIGN });

    expect(listed[0]?.reviews).toHaveLength(0);
    expect(loggerWarn).toHaveBeenCalledWith(
      "campaign.deliverable_review_unreadable",
      expect.objectContaining({ organizationId: ORGANIZATION }),
    );
  });

  it("keeps a review whose timestamp wears the database's offset suffix", async () => {
    // PostgREST renders timestamptz with an explicit +00:00 suffix. Rejecting
    // the transport format once hid every review behind "nobody has reviewed".
    const listed = await createDeliverableRepository(
      listClient(
        listTables({
          campaign_deliverable_reviews: {
            data: [
              {
                id: "55555555-5555-4555-8555-555555555555",
                organization_id: ORGANIZATION,
                deliverable_id: DELIVERABLE,
                deliverable_version_id: VERSION,
                content_hash: HASH,
                actor_id: "66666666-6666-4666-8666-666666666666",
                decision: "approved",
                reason_codes: [],
                note: null,
                reviewed_at: "2026-09-17T15:44:32.634299+00:00",
              },
            ],
            error: null,
          },
        }),
      ),
    ).listForCampaign({ organizationId: ORGANIZATION, campaignId: CAMPAIGN });

    expect(listed[0]?.reviews).toHaveLength(1);
  });
});
