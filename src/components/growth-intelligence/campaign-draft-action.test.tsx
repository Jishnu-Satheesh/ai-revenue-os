// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { CampaignDraftAction } from "@/components/growth-intelligence/campaign-draft-action";
import type { OpportunityCard } from "@/modules/growth-intelligence/application/read-model";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";
const OPPORTUNITY = "50000000-0000-4000-8000-000000000005";

const fetchMock = vi.fn(
  async () =>
    new Response(JSON.stringify({ outcome: "created", requestId: "request-1" }), {
      status: 200,
    }),
);

function card(overrides: Partial<OpportunityCard> = {}): OpportunityCard {
  return {
    id: OPPORTUNITY,
    source: { kind: "opportunity", id: OPPORTUNITY },
    title: "Shift budget",
    detail: "Move spend.",
    generatedAt: "2026-09-01T07:00:00.000Z",
    evidenceWindow: null,
    marketObservedAt: null,
    decision: null,
    decidedAt: null,
    snoozedUntil: null,
    pinned: false,
    carriedOver: false,
    ageLabel: null,
    actionKey: "campaign.governed_draft_v1",
    status: "proposed",
    expiresAt: "2026-10-01T00:00:00.000Z",
    evidenceTier: "computed",
    impactLowMinor: 100_00,
    impactHighMinor: 400_00,
    expectedContributionMinor: 300_00,
    executionCostMinor: 50_00,
    currency: "AED",
    timeToImpactDays: 14,
    version: 1,
    draftRequest: null,
    ...overrides,
  };
}

const shared = { organizationId: ORGANIZATION, timeZone: "Asia/Dubai" };

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("crypto", { randomUUID: () => "idempotency-key-000000000001" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  refresh.mockClear();
  fetchMock.mockClear();
});

describe("CampaignDraftAction", () => {
  it("submits the exact version and identity, then waits for the outcome", async () => {
    render(<CampaignDraftAction card={card()} canManage {...shared} />);

    fireEvent.change(screen.getByLabelText("Objective"), {
      target: { value: "Lift September profit" },
    });
    fireEvent.change(screen.getByLabelText("Audience"), {
      target: { value: "Weekend regulars" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create governed draft" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const call = vi.mocked(fetch).mock.calls[0]!;
    expect(call[0]).toBe(
      `/api/organizations/${ORGANIZATION}/opportunities/${OPPORTUNITY}/campaign-draft`,
    );
    expect(JSON.parse((call[1] as RequestInit).body as string)).toMatchObject({
      opportunityVersion: 1,
      objective: "Lift September profit",
      audience: "Weekend regulars",
    });
  });

  it("shows pending, retryable failure, and success link states without inventing any", () => {
    render(
      <CampaignDraftAction
        card={card({
          status: "draft_requested",
          draftRequest: {
            opportunityId: OPPORTUNITY,
            status: "processing",
            campaignId: null,
            requestedAt: "2026-09-03T08:00:00.000Z",
            updatedAt: "2026-09-03T09:00:00.000Z",
          },
        })}
        canManage
        {...shared}
      />,
    );
    expect(screen.getByText(/draft is being prepared/i)).toBeTruthy();

    cleanup();
    render(
      <CampaignDraftAction
        card={card({
          status: "draft_requested",
          draftRequest: {
            opportunityId: OPPORTUNITY,
            status: "retryable_failed",
            campaignId: null,
            requestedAt: "2026-09-03T08:00:00.000Z",
            updatedAt: "2026-09-03T09:00:00.000Z",
          },
        })}
        canManage
        {...shared}
      />,
    );
    expect(screen.getByRole("button", { name: "Retry draft request" })).toBeTruthy();

    cleanup();
    const campaignId = "40000000-0000-4000-8000-000000000004";
    render(
      <CampaignDraftAction
        card={card({
          status: "draft_created",
          draftRequest: {
            opportunityId: OPPORTUNITY,
            status: "completed",
            campaignId,
            requestedAt: "2026-09-03T08:00:00.000Z",
            updatedAt: "2026-09-03T10:00:00.000Z",
          },
        })}
        canManage
        {...shared}
      />,
    );
    expect(screen.getByRole("link", { name: /open draft/i })).toHaveAttribute(
      "href",
      `/organizations/${ORGANIZATION}/campaigns/${campaignId}`,
    );
  });

  it("never offers approval language and never shows a control to viewers", () => {
    const { container } = render(
      <CampaignDraftAction card={card()} canManage={false} {...shared} />,
    );
    expect(container.textContent).not.toMatch(/approve/i);
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("input, textarea")).toBeNull();
  });
});
