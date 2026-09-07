// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { MarketProfileReview } from "@/components/growth-intelligence/market-profile-review";
import type { MarketProfileView } from "@/modules/growth-intelligence/application/ports";

const organizationId = "10000000-0000-4000-8000-000000000001";
const versionId = "40000000-0000-4000-8000-000000000004";

const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
  if (url.endsWith("/market-profile")) {
    return new Response(
      JSON.stringify({
        marketProfile: {
          profile: {
            id: "p1",
            currentVersionId: versionId,
            enabled: true,
            nextDailyResearchDueAt: null,
            nextWeeklySynthesisDueAt: null,
          },
          versions: [],
          decisions: [],
        },
      }),
      { status: 200 },
    );
  }
  return new Response(JSON.stringify({ decision: { decisionId: "d1" } }), { status: 200 });
});

function profileView(): MarketProfileView {
  return {
    profile: {
      id: "p1",
      currentVersionId: null,
      enabled: true,
      nextDailyResearchDueAt: null,
      nextWeeklySynthesisDueAt: null,
    },
    versions: [
      {
        id: versionId,
        profileId: "p1",
        version: 1,
        document: {
          schemaVersion: 1,
          publicIdentity: {
            approvedName: "Kerala Kitchen",
            domains: ["example.com"],
            publicUrls: ["https://example.com/menu"],
          },
          nicheDescriptors: ["Kerala cuisine"],
          geographies: [{ layer: "city", locationRef: "ae:du", name: "Dubai", countryCode: "AE" }],
          competitors: [],
          topics: [],
          sourcePolicy: {
            excludedDomains: [],
            excludedPublishers: [],
            excludedCompetitorKeys: [],
            allowBoundedQuotes: false,
            maxQuotationCharacters: 0,
          },
          cadence: {
            timeZone: "Asia/Dubai",
            dailyLocalTime: "06:30",
            weeklyDay: "monday",
            weeklyLocalTime: "07:00",
          },
        },
        digest: "d".repeat(64),
        proposalSource: "ai",
        createdAt: "2026-09-01T06:00:00Z",
      },
    ],
    decisions: [],
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-4000-8000-000000000000" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  refresh.mockClear();
  fetchMock.mockClear();
});

describe("MarketProfileReview", () => {
  it("shows the pending proposal without mutation controls for viewers", () => {
    render(
      <MarketProfileReview
        organizationId={organizationId}
        profile={profileView()}
        canManage={false}
      />,
    );

    expect(screen.getByText(/Kerala Kitchen/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /confirm/i })).toBeNull();
  });

  it("confirms non-optimistically: success appears only after the authoritative read", async () => {
    render(
      <MarketProfileReview
        organizationId={organizationId}
        profile={profileView()}
        canManage={true}
      />,
    );

    expect(screen.queryByText(/confirmed and active/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /confirm profile/i }));
    await waitFor(() => expect(screen.getByText(/confirmed and active/i)).toBeTruthy());

    const decisionCall = fetchMock.mock.calls[0]!;
    expect(decisionCall[0]).toBe(
      `/api/organizations/${organizationId}/market-profile/versions/${versionId}/decisions`,
    );
    expect(JSON.parse(decisionCall[1]!.body as string)).toMatchObject({
      decision: "confirmed",
      profileDigest: "d".repeat(64),
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("reports a failed decision without changing anything", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "DOMAIN_ERROR" } }), { status: 422 }),
    );

    render(
      <MarketProfileReview
        organizationId={organizationId}
        profile={profileView()}
        canManage={true}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /confirm profile/i }));
    await waitFor(() => expect(screen.getByText(/could not be saved/i)).toBeTruthy());
    expect(refresh).not.toHaveBeenCalled();
  });

  it("names the confirmed version when one is already active", () => {
    render(
      <MarketProfileReview
        organizationId={organizationId}
        profile={{
          ...profileView(),
          profile: { ...profileView().profile!, currentVersionId: versionId },
        }}
        canManage={true}
      />,
    );

    expect(screen.getByText(/version 1 is active/i)).toBeTruthy();
  });
});
