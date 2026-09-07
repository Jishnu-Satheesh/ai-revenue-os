// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

afterEach(cleanup);

import { OpportunityFeedView } from "@/components/opportunities/opportunity-feed";
import { buildOpportunityFeed } from "@/modules/decisions/application/feed";
import type { OpportunityFeedItem } from "@/modules/decisions/application/ports";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-08-15T10:00:00.000Z");

function item(overrides: Partial<OpportunityFeedItem> = {}): OpportunityFeedItem {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    organizationId: ORGANIZATION_ID,
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

function renderFeed(
  items: readonly OpportunityFeedItem[],
  role: "owner" | "operator" | "viewer" = "operator",
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <OpportunityFeedView
        organizationId={ORGANIZATION_ID}
        timeZone="Asia/Dubai"
        initialFeed={buildOpportunityFeed({ items, role, now: NOW })}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ feedbackId: "feedback-1" }), { status: 201 })),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("OpportunityFeedView", () => {
  it("separates tiers so a measured range is never mixed with an assumed one", () => {
    renderFeed([
      item({ id: "aaaaaaaa-0000-4000-8000-000000000001", evidenceTier: "computed" }),
      item({ id: "aaaaaaaa-0000-4000-8000-000000000002", evidenceTier: "prior" }),
    ]);

    const headings = screen.getAllByRole("heading", { level: 2 }).map((node) => node.textContent);
    expect(headings).toEqual(["Backed by your data", "Starting assumptions"]);
  });

  it("shows the impact as a range with the evidence it rests on", () => {
    renderFeed([item()]);

    expect(screen.getByText(/AED\s?6,000 to AED\s?9,000/)).toBeInTheDocument();
    expect(screen.getByText("From your data")).toBeInTheDocument();
  });

  it("renders the expiry in the organization timezone, not the browser's", () => {
    renderFeed([item({ expiresAt: "2026-08-22T20:00:00.000Z" })]);

    // 20:00 UTC is midnight the next day in Asia/Dubai.
    expect(screen.getByText(/23 Aug 2026/)).toBeInTheDocument();
  });

  it("explains why an expired proposal cannot be answered instead of hiding it", () => {
    renderFeed([item({ expiresAt: "2026-08-15T09:00:00.000Z" })]);

    expect(screen.getByText(/expired, so it can no longer be answered/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("tells a viewer their role cannot answer rather than showing a dead control", () => {
    renderFeed([item()], "viewer");

    expect(screen.getByText(/role can read this proposal but not answer it/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("offers the governed answers to an operator", () => {
    renderFeed([item()]);

    for (const label of ["Approve", "Edit", "Reject", "Snooze", "Ask for evidence"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("posts an approval to the organization-scoped feedback route", async () => {
    renderFeed([item()]);

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      `/api/organizations/${ORGANIZATION_ID}/opportunities/22222222-2222-4222-8222-222222222222/feedback`,
    );
    expect(JSON.parse(String(init.body))).toMatchObject({ feedbackKind: "approved" });
  });

  it("surfaces a refused answer instead of showing it as accepted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { code: "AUTHORIZATION_ERROR", message: "Role is refused." } }),
            { status: 403 },
          ),
      ),
    );
    renderFeed([item()]);

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Role is refused.");
  });

  it("says nothing is waiting rather than inventing a proposal", () => {
    renderFeed([]);

    expect(screen.getByText("No open proposals")).toBeInTheDocument();
  });
});
