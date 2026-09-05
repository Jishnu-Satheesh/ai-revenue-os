import { describe, expect, it } from "vitest";

import { buildOpportunityFeed } from "@/modules/decisions/application/feed";
import type { OpportunityFeedItem } from "@/modules/decisions/application/ports";

const NOW = new Date("2026-08-15T10:00:00.000Z");

function item(overrides: Partial<OpportunityFeedItem> = {}): OpportunityFeedItem {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    organizationId: "22222222-2222-4222-8222-222222222222",
    decisionRecordId: "33333333-3333-4333-8333-333333333333",
    playbookVersionId: "44444444-4444-4444-8444-444444444444",
    actionKey: "campaign.meta_bundle_v1",
    createdAt: "2026-08-01T10:00:00.000Z",
    title: "Run a governed Meta campaign",
    summary: "A bounded recommendation with a registered measurement plan.",
    evidenceTier: "computed",
    impactLowMinor: 600_000,
    impactHighMinor: 900_000,
    executionCostMinor: 450_000,
    expectedContributionMinor: 112_500,
    currency: "AED",
    timeToImpactDays: 7,
    status: "proposed",
    expiresAt: "2026-08-22T10:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

describe("buildOpportunityFeed", () => {
  it("groups by evidence tier in computed, observed, prior order", () => {
    const feed = buildOpportunityFeed({
      items: [
        item({ id: "aaaaaaaa-0000-4000-8000-000000000001", evidenceTier: "prior" }),
        item({ id: "aaaaaaaa-0000-4000-8000-000000000002", evidenceTier: "computed" }),
        item({ id: "aaaaaaaa-0000-4000-8000-000000000003", evidenceTier: "observed" }),
      ],
      role: "operator",
      now: NOW,
    });

    expect(feed.groups.map((group) => group.evidenceTier)).toEqual([
      "computed",
      "observed",
      "prior",
    ]);
  });

  it("omits a tier that has no opportunity rather than showing an empty heading", () => {    const feed = buildOpportunityFeed({
      items: [item({ evidenceTier: "observed" })],
      role: "operator",
      now: NOW,
    });

    expect(feed.groups.map((group) => group.evidenceTier)).toEqual(["observed"]);
  });

  it("offers no feedback action on a governed-draft entry; drafts are requested, never approved", () => {
    const feed = buildOpportunityFeed({
      items: [item({ actionKey: "campaign.governed_draft_v1" })],
      role: "operator",
      now: NOW,
    });

    const entry = feed.groups[0]?.items[0];
    expect(entry?.availableActions).toEqual([]);
    expect(entry?.actionKey).toBe("campaign.governed_draft_v1");
  });

  it("ranks within a tier by expected contribution, then by the sooner impact", () => {
    const feed = buildOpportunityFeed({
      items: [
        item({
          id: "bbbbbbbb-0000-4000-8000-000000000001",
          expectedContributionMinor: 100_000,
          timeToImpactDays: 30,
        }),
        item({
          id: "bbbbbbbb-0000-4000-8000-000000000002",
          expectedContributionMinor: 100_000,
          timeToImpactDays: 7,
        }),
        item({
          id: "bbbbbbbb-0000-4000-8000-000000000003",
          expectedContributionMinor: 250_000,
          timeToImpactDays: 60,
        }),
      ],
      role: "operator",
      now: NOW,
    });

    expect(feed.groups[0]?.items.map((entry) => entry.id)).toEqual([
      "bbbbbbbb-0000-4000-8000-000000000003",
      "bbbbbbbb-0000-4000-8000-000000000002",
      "bbbbbbbb-0000-4000-8000-000000000001",
    ]);
  });

  it("carries the impact range and its tier together, never a single headline number", () => {
    const feed = buildOpportunityFeed({
      items: [item({ impactLowMinor: 600_000, impactHighMinor: 900_000 })],
      role: "operator",
      now: NOW,
    });

    const entry = feed.groups[0]?.items[0];
    expect(entry?.impact).toEqual({
      lowMinor: 600_000,
      highMinor: 900_000,
      currency: "AED",
      evidenceTier: "computed",
    });
  });

  it("blocks an expired opportunity from every action while keeping it visible", () => {
    const feed = buildOpportunityFeed({
      items: [item({ expiresAt: "2026-08-15T09:59:59.000Z" })],
      role: "owner",
      now: NOW,
    });

    const entry = feed.groups[0]?.items[0];
    expect(entry?.isExpired).toBe(true);
    expect(entry?.availableActions).toEqual([]);
    expect(entry?.blockedReason).toBe("expired");
  });

  it("treats the exact expiry instant as expired, matching the database check", () => {
    const feed = buildOpportunityFeed({
      items: [item({ expiresAt: NOW.toISOString() })],
      role: "owner",
      now: NOW,
    });

    expect(feed.groups[0]?.items[0]?.isExpired).toBe(true);
  });

  it("offers no action to a viewer, who may read the feed but not answer it", () => {
    const feed = buildOpportunityFeed({ items: [item()], role: "viewer", now: NOW });

    const entry = feed.groups[0]?.items[0];
    expect(entry?.availableActions).toEqual([]);
    expect(entry?.blockedReason).toBe("role_not_permitted");
  });

  it("offers the full governed answer set to an operator", () => {
    const feed = buildOpportunityFeed({ items: [item()], role: "operator", now: NOW });

    expect(feed.groups[0]?.items[0]?.availableActions).toEqual([
      "approved",
      "edited",
      "rejected",
      "snoozed",
      "more_evidence_requested",
    ]);
  });

  it("shows only opportunities an operator can still answer", () => {
    const feed = buildOpportunityFeed({
      items: [
        item({ id: "cccccccc-0000-4000-8000-000000000001", status: "proposed" }),
        item({ id: "cccccccc-0000-4000-8000-000000000002", status: "awaiting_approval" }),
        item({ id: "cccccccc-0000-4000-8000-000000000003", status: "rejected" }),
        item({ id: "cccccccc-0000-4000-8000-000000000004", status: "snoozed" }),
        item({ id: "cccccccc-0000-4000-8000-000000000005", status: "expired" }),
      ],
      role: "operator",
      now: NOW,
    });

    expect(feed.groups.flatMap((group) => group.items).map((entry) => entry.id)).toEqual([
      "cccccccc-0000-4000-8000-000000000001",
      "cccccccc-0000-4000-8000-000000000002",
    ]);
  });

  it("counts what it hid so the feed never silently truncates", () => {
    const feed = buildOpportunityFeed({
      items: [item({ status: "proposed" }), item({ status: "rejected" })],
      role: "operator",
      now: NOW,
    });

    expect(feed.answeredCount).toBe(1);
  });

  it("reports an empty feed as empty rather than inventing a candidate", () => {
    const feed = buildOpportunityFeed({ items: [], role: "operator", now: NOW });

    expect(feed.groups).toEqual([]);
    expect(feed.totalCount).toBe(0);
  });

  it("never surfaces an opportunity belonging to another organization", () => {
    expect(() =>
      buildOpportunityFeed({
        items: [item({ organizationId: "99999999-9999-4999-8999-999999999999" })],
        role: "operator",
        now: NOW,
        organizationId: "22222222-2222-4222-8222-222222222222",
      }),
    ).toThrow(/organization/i);
  });

  it("keeps a future draft lifecycle state out of the answerable queue without failing", () => {
    const feed = buildOpportunityFeed({
      items: [
        item({
          status: "draft_requested" as OpportunityFeedItem["status"],
        }),
      ],
      role: "operator",
      now: NOW,
    });

    expect(feed.groups).toEqual([]);
    expect(feed.totalCount).toBe(0);
  });
});
