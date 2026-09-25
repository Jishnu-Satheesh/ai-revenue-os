// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AgentCampaignAdvice,
  type CampaignAdviceContext,
} from "@/components/agent/agent-campaign-advice";
import type { AdviseCampaignSeams } from "@/modules/agent-chat/application/campaign-advise";
import type { ThreadSummary } from "@/modules/agent-chat/infrastructure/thread-repository";

const ORGANIZATION = "00000000-0000-4000-8000-000000000000";
const ACTOR = "11111111-1111-4111-8111-111111111111";
const THREAD_ID = "22222222-2222-4222-8222-222222222222";
const OPPORTUNITY = { id: "33333333-3333-4333-8333-333333333333", version: 2 };
const DRAFT_REQUEST = "44444444-4444-4444-8444-444444444444";

const THREAD: ThreadSummary = {
  id: THREAD_ID,
  organizationId: ORGANIZATION,
  title: "New chat",
  mode: "quick",
  status: "open",
  linkedResearchProjectId: null,
  linkedRequestId: null,
  linkedDraftRequestId: null,
  linkedCampaignId: null,
  createdAt: "2026-09-25T10:00:00.000Z",
  updatedAt: "2026-09-25T10:00:00.000Z",
};

const ADVICE: CampaignAdviceContext = {
  assertions: [{ key: "demand_window", expectedOutcome: "pass" }],
  evidenceSnapshot: {
    windowDays: 30,
    observedAt: "2026-09-20T10:00:00.000Z",
    digest: "0123456789abcdef",
    citations: ["ledger:2026-09-01:2026-09-20"],
  },
  evidenceSnapshotFreezable: true,
  marketProfile: { versionId: "mp-v3", digest: "fedcba9876543210" },
  policyPass: true,
  capabilityPass: true,
  schedulePass: true,
  audienceReady: true,
  estimate: {
    valueText: "+AED 4,000 gross profit / week",
    inputs: ["weekday-evening covers, last 30 days"],
    assumptions: ["no menu-price change during the window"],
  },
};

function fakeSeams(): AdviseCampaignSeams & {
  drafts: { requestDraft: ReturnType<typeof vi.fn> };
  links: { setThreadLinks: ReturnType<typeof vi.fn> };
} {
  return {
    drafts: {
      requestDraft: vi.fn(async () => ({
        outcome: "created" as const,
        requestId: DRAFT_REQUEST,
        draftRequestStatus: "pending",
      })),
    },
    links: { setThreadLinks: vi.fn(async () => ({ threadId: THREAD_ID })) },
  };
}

async function fillIntent(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Objective"), "Lift weekday-evening profit");
  await user.type(screen.getByLabelText("Audience"), "Nearby families");
}

afterEach(() => {
  cleanup();
});

describe("campaign advice card", () => {
  it("keeps the primary disabled for viewers with a permission title", () => {
    render(
      <AgentCampaignAdvice
        organizationId={ORGANIZATION}
        threadId={THREAD_ID}
        thread={THREAD}
        canDraft={false}
        isViewer
      />,
    );
    const initiate = screen.getByRole("button", { name: /initiate campaign draft/i });
    expect(initiate).toBeDisabled();
    expect(initiate).toHaveAttribute("title", expect.stringMatching(/campaign\.create/));
    expect(screen.getByRole("button", { name: /save to recommendations/i })).toBeDisabled();
  });

  it("resolves to a prefilled brief with named reasons when no opportunity is bound", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn(async () => {
      throw new Error("must not fetch on the brief path");
    });
    globalThis.fetch = fetchSpy as never;
    render(
      <AgentCampaignAdvice
        organizationId={ORGANIZATION}
        threadId={THREAD_ID}
        thread={THREAD}
        canDraft
        isViewer={false}
      />,
    );

    await fillIntent(user);
    await user.click(screen.getByRole("button", { name: /initiate campaign draft/i }));

    const link = await screen.findByRole("link", { name: /open prefilled brief/i });
    expect(link.getAttribute("href")).toContain("/campaigns/new");
    expect(link.getAttribute("href")).toContain("objective=Lift+weekday-evening+profit");
    expect(await screen.findByText(/ADVICE_NO_OPPORTUNITY/)).toBeInTheDocument();
    expect(screen.queryByText(/silent upgrade/)).not.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("admits one draft on the eligible path with markers and the Bundle link", async () => {
    const user = userEvent.setup();
    const seam = fakeSeams();
    render(
      <AgentCampaignAdvice
        organizationId={ORGANIZATION}
        actorId={ACTOR}
        threadId={THREAD_ID}
        thread={THREAD}
        canDraft
        isViewer={false}
        opportunity={OPPORTUNITY}
        advice={ADVICE}
        seams={seam}
      />,
    );

    await fillIntent(user);
    await user.click(screen.getByRole("button", { name: /initiate campaign draft/i }));

    expect(seam.drafts.requestDraft).toHaveBeenCalledTimes(1);
    expect(seam.drafts.requestDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        opportunityId: OPPORTUNITY.id,
        opportunityVersion: 2,
        actionKey: "campaign.governed_draft_v1",
      }),
    );
    expect(seam.links.setThreadLinks).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      actorId: ACTOR,
      threadId: THREAD_ID,
      draftRequestId: DRAFT_REQUEST,
    });
    // Markers track requested → claimed → draft-ready with the Bundle link.
    expect(await screen.findByText("Requested")).toBeInTheDocument();
    expect(screen.getByText("Claimed")).toBeInTheDocument();
    expect(screen.getByText("Draft ready")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /campaign bundle review/i })).toHaveAttribute(
      "href",
      `/organizations/${ORGANIZATION}/campaigns`,
    );
    // The estimate stays labeled with inputs and assumptions on the same surface.
    expect(screen.getByText("Estimate")).toBeInTheDocument();
    expect(screen.getByText(/\+AED 4,000 gross profit \/ week/)).toBeInTheDocument();
    expect(screen.getByText(/weekday-evening covers/)).toBeInTheDocument();
    expect(screen.getByText(/no menu-price change/)).toBeInTheDocument();
  });

  it("flags material edits after a draft request as invalidating the review", async () => {
    const user = userEvent.setup();
    render(
      <AgentCampaignAdvice
        organizationId={ORGANIZATION}
        actorId={ACTOR}
        threadId={THREAD_ID}
        thread={THREAD}
        canDraft
        isViewer={false}
        opportunity={OPPORTUNITY}
        advice={ADVICE}
        seams={fakeSeams()}
      />,
    );

    await fillIntent(user);
    await user.click(screen.getByRole("button", { name: /initiate campaign draft/i }));
    expect(await screen.findByText("Requested")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Audience"), " and tourists");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /changed since the draft was requested/,
    );
  });

  it("saves recommendations as manual actions with plan, snooze, and dismiss", async () => {
    const user = userEvent.setup();
    render(
      <AgentCampaignAdvice
        organizationId={ORGANIZATION}
        threadId={THREAD_ID}
        thread={THREAD}
        canDraft
        isViewer={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: /save to recommendations/i }));
    expect(await screen.findByText(/never completes itself/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^snooze$/i }));
    expect(await screen.findByText(/snoozed/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^dismiss$/i }));
    expect(await screen.findByText(/dismissed/)).toBeInTheDocument();
  });

  it("shows the linked draft progress for an already-linked thread", () => {
    render(
      <AgentCampaignAdvice
        organizationId={ORGANIZATION}
        threadId={THREAD_ID}
        thread={{ ...THREAD, linkedDraftRequestId: DRAFT_REQUEST }}
        canDraft
        isViewer={false}
      />,
    );
    expect(screen.getByText("Requested")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(DRAFT_REQUEST))).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /campaign bundle review/i })).toBeInTheDocument();
  });
});
