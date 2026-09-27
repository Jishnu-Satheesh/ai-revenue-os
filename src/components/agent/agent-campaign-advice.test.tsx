// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { AgentCampaignAdvice } from "@/components/agent/agent-campaign-advice";
import type { IdeaDraftOutcome } from "@/modules/agent-chat/application/campaign-advise";
import type { ThreadSummary } from "@/modules/agent-chat/infrastructure/thread-repository";

const ORGANIZATION = "00000000-0000-4000-8000-000000000000";
const THREAD_ID = "22222222-2222-4222-8222-222222222222";
const DRAFT_REQUEST = "44444444-4444-4444-8444-444444444444";
const FINGERPRINT = "0123456789abcdef";

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

const IDEA = {
  value: "idea-b",
  title: "Weekend family table",
  description: "Saturday set menu for families.",
  recommended: true,
};

function draftResult(replayed = false): IdeaDraftOutcome {
  return {
    outcome: "draft_requested",
    draftRequestId: DRAFT_REQUEST,
    replayed,
    idempotencyKey: `agent_thread:${THREAD_ID}:abc123abc123abc1`,
    idea: { ...IDEA },
    adviceFingerprint: FINGERPRINT,
    approveAction: {
      kind: "campaign_idea_approve",
      draftRequestId: DRAFT_REQUEST,
      adviceFingerprint: FINGERPRINT,
      href: `/organizations/${ORGANIZATION}/campaigns`,
    },
    studioLink: {
      href: `/organizations/${ORGANIZATION}/campaigns`,
      ref: { draftRequestId: DRAFT_REQUEST, campaignId: null },
    },
    markers: [
      { stage: "requested", state: "active", label: "Requested" },
      { stage: "claimed", state: "pending", label: "Claimed" },
      { stage: "draft-ready", state: "pending", label: "Draft ready" },
    ],
    reasonCodes: [],
  };
}

function briefResult(): IdeaDraftOutcome {
  return {
    outcome: "brief_prefilled",
    idea: { ...IDEA },
    briefUrl: `/organizations/${ORGANIZATION}/campaigns/new?objective=Weekend+family+table&audience=Saturday+set+menu+for+families.&reason=ADVICE_NO_OPPORTUNITY`,
    prefill: { objective: IDEA.title, audience: IDEA.description },
    reasonCodes: ["ADVICE_NO_OPPORTUNITY"],
  };
}

afterEach(() => {
  cleanup();
});

describe("campaign advice card (ideas-first)", () => {
  it("renders no form: the pick starts the draft, approval stays in review", () => {
    render(
      <AgentCampaignAdvice
        organizationId={ORGANIZATION}
        threadId={THREAD_ID}
        thread={THREAD}
        canDraft
        isViewer={false}
      />,
    );
    expect(screen.queryByLabelText("Objective")).toBeNull();
    expect(screen.queryByLabelText("Audience")).toBeNull();
    expect(screen.queryByRole("button", { name: /initiate campaign draft/i })).toBeNull();
    expect(screen.getByText(/pick an idea above/i)).toBeInTheDocument();
  });

  it("keeps the approve action disabled for viewers with a permission title", () => {
    render(
      <AgentCampaignAdvice
        organizationId={ORGANIZATION}
        threadId={THREAD_ID}
        thread={THREAD}
        canDraft={false}
        isViewer
        ideaDraft={draftResult()}
      />,
    );
    const approve = screen.getByRole("button", { name: /review and approve this version/i });
    expect(approve).toBeDisabled();
    expect(approve).toHaveAttribute("title", expect.stringMatching(/campaign\.create/));
    expect(screen.getByRole("button", { name: /save to recommendations/i })).toBeDisabled();
  });

  it("renders the picked idea with the recommended marker and both approval surfaces", () => {
    render(
      <AgentCampaignAdvice
        organizationId={ORGANIZATION}
        threadId={THREAD_ID}
        thread={THREAD}
        canDraft
        isViewer={false}
        ideaDraft={draftResult()}
      />,
    );

    // The picked idea, echoed: title, description, exactly one Recommended badge.
    expect(screen.getByText("Weekend family table")).toBeInTheDocument();
    expect(screen.getByText("Saturday set menu for families.")).toBeInTheDocument();
    expect(screen.getAllByText("Recommended")).toHaveLength(1);
    // Exact-version binding is named on the surface.
    expect(screen.getByText(/approval binds this exact version/i)).toBeInTheDocument();
    // Inline approve action plus the Studio hyperlink, one payload.
    const approve = screen.getByRole("link", { name: /review and approve this version/i });
    expect(approve.getAttribute("href")).toBe(`/organizations/${ORGANIZATION}/campaigns`);
    const studio = screen.getByRole("link", { name: /open in studio/i });
    expect(studio.getAttribute("href")).toBe(`/organizations/${ORGANIZATION}/campaigns`);
    // Markers track requested → claimed → draft-ready with the Bundle link.
    expect(screen.getByText("Requested")).toBeInTheDocument();
    expect(screen.getByText("Claimed")).toBeInTheDocument();
    expect(screen.getByText("Draft ready")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /campaign bundle review/i })).toHaveAttribute(
      "href",
      `/organizations/${ORGANIZATION}/campaigns`,
    );
  });

  it("names the replay instead of double-posting", () => {
    render(
      <AgentCampaignAdvice
        organizationId={ORGANIZATION}
        threadId={THREAD_ID}
        thread={THREAD}
        canDraft
        isViewer={false}
        ideaDraft={draftResult(true)}
      />,
    );
    expect(screen.getByText(/already requested — showing the kept draft/i)).toBeInTheDocument();
  });

  it("resolves to the prefilled brief with named reasons when the pick was ineligible", () => {
    render(
      <AgentCampaignAdvice
        organizationId={ORGANIZATION}
        threadId={THREAD_ID}
        thread={THREAD}
        canDraft
        isViewer={false}
        ideaDraft={briefResult()}
      />,
    );

    const link = screen.getByRole("link", { name: /open prefilled brief/i });
    expect(link.getAttribute("href")).toContain("/campaigns/new");
    expect(screen.getByText(/ADVICE_NO_OPPORTUNITY/)).toBeInTheDocument();
    expect(screen.queryByText(/silent upgrade/)).not.toBeNull();
    // No draft surfaces beside the brief.
    expect(screen.queryByRole("link", { name: /review and approve this version/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /open in studio/i })).toBeNull();
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
});
