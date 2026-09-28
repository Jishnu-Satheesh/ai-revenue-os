// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AgentThreadSteps } from "@/components/agent/agent-thread-steps";
import type { ThreadSummary } from "@/modules/agent-chat/infrastructure/thread-repository";

const ORGANIZATION = "00000000-0000-4000-8000-000000000000";

const THREAD: ThreadSummary = {
  id: "11111111-1111-4111-8111-111111111111",
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

function stepsRegion(): HTMLElement {
  return screen.getByLabelText("Agent run steps");
}

function statusMarkers(): HTMLElement[] {
  return Array.from(
    stepsRegion().querySelectorAll('[data-slot="marker"][role="status"]'),
  ) as HTMLElement[];
}

afterEach(() => {
  cleanup();
});

describe("narrating steps (F4)", () => {
  it("shows exactly one active row while classifying, then resolves Thinking", () => {
    render(<AgentThreadSteps phase="routing" />);
    const region = stepsRegion();
    expect(statusMarkers()).toHaveLength(1);
    expect(within(region).getByText("Thinking…")).toBeInTheDocument();
    expect(within(region).queryByText(/understood/i)).toBeNull();
  });

  it("narrates the memory lane while routing and resolves it when done", () => {
    const { unmount } = render(<AgentThreadSteps phase="routing" intent="answer_memory" />);
    const region = stepsRegion();
    expect(statusMarkers()).toHaveLength(1);
    expect(within(region).getByText(/checking organization memory/i)).toBeInTheDocument();
    expect(within(region).queryByText("Thinking…")).toBeNull();
    unmount();

    render(<AgentThreadSteps phase="done" intent="answer_memory" />);
    const done = stepsRegion();
    expect(statusMarkers()).toHaveLength(0);
    expect(done.querySelector('[data-slot="spinner"]')).toBeNull();
    expect(within(done).getByText("Understood: Memory answer")).toBeInTheDocument();
    expect(within(done).getByText("Checked organization memory")).toBeInTheDocument();
  });

  it("narrates the research lane and lands Research complete with the GI link", () => {
    const linked: ThreadSummary = {
      ...THREAD,
      mode: "deepthink",
      linkedResearchProjectId: "55555555-5555-4555-8555-555555555555",
    };
    const { unmount } = render(
      <AgentThreadSteps phase="routing" intent="research_once" thread={linked} />,
    );
    expect(statusMarkers()).toHaveLength(1);
    expect(within(stepsRegion()).getByText("Researching…")).toBeInTheDocument();
    unmount();

    render(
      <AgentThreadSteps
        phase="done"
        intent="research_once"
        thread={linked}
        growthIntelligenceHref={`/organizations/${ORGANIZATION}/growth-intelligence`}
      />,
    );
    const done = stepsRegion();
    expect(statusMarkers()).toHaveLength(0);
    expect(done.querySelector('[data-slot="spinner"]')).toBeNull();
    expect(within(done).getByText("Understood: One-time research")).toBeInTheDocument();
    expect(within(done).getByText("Checked organization memory")).toBeInTheDocument();
    const link = within(done).getByRole("link", { name: /research complete/i });
    expect(link.getAttribute("href")).toContain("/growth-intelligence");
  });

  it("narrates the draft lane and lands Draft ready", () => {
    const linked: ThreadSummary = {
      ...THREAD,
      linkedDraftRequestId: "44444444-4444-4444-8444-444444444444",
    };
    const { unmount } = render(
      <AgentThreadSteps phase="routing" intent="campaign_advice" thread={linked} />,
    );
    expect(statusMarkers()).toHaveLength(1);
    expect(within(stepsRegion()).getByText("Preparing draft…")).toBeInTheDocument();
    unmount();

    render(<AgentThreadSteps phase="done" intent="campaign_advice" thread={linked} />);
    const done = stepsRegion();
    expect(statusMarkers()).toHaveLength(0);
    expect(done.querySelector('[data-slot="spinner"]')).toBeNull();
    expect(within(done).getByText("Understood: Campaign advice")).toBeInTheDocument();
    expect(within(done).getByText("Draft ready")).toBeInTheDocument();
  });

  it("flips every row terminal once the phase is done, even while the thread still reads running", () => {
    const running: ThreadSummary = { ...THREAD, status: "running" };
    render(<AgentThreadSteps phase="done" intent="answer_memory" thread={running} />);
    const done = stepsRegion();
    expect(statusMarkers()).toHaveLength(0);
    expect(done.querySelector('[data-slot="spinner"]')).toBeNull();
    expect(within(done).queryByText("Thinking…")).toBeNull();
    expect(within(done).queryByText(/exploring/i)).toBeNull();
    expect(within(done).getByText("Understood: Memory answer")).toBeInTheDocument();
    expect(within(done).getByText("Checked organization memory")).toBeInTheDocument();
    // A bare `running` status never claims finished research on a memory turn.
    expect(within(done).queryByText(/research complete/i)).toBeNull();
  });

  it("stays honest on bare running: Thinking, never Researching", () => {
    const running: ThreadSummary = { ...THREAD, status: "running" };
    render(<AgentThreadSteps phase="routing" thread={running} />);
    const region = stepsRegion();
    expect(statusMarkers()).toHaveLength(1);
    expect(within(region).getByText("Thinking…")).toBeInTheDocument();
    expect(within(region).queryByText("Researching…")).toBeNull();
  });

  it("keeps the memory lane reachable while the thread still reads running", () => {
    const running: ThreadSummary = { ...THREAD, status: "running" };
    render(<AgentThreadSteps phase="routing" intent="answer_memory" thread={running} />);
    const region = stepsRegion();
    expect(statusMarkers()).toHaveLength(1);
    expect(within(region).getByText(/checking organization memory/i)).toBeInTheDocument();
    expect(within(region).queryByText("Researching…")).toBeNull();
  });

  it("styles done rows as side-line rows", () => {
    render(<AgentThreadSteps phase="done" intent="answer_memory" />);
    const done = stepsRegion();
    const understood = within(done).getByText("Understood: Memory answer");
    const row = understood.closest('[data-slot="marker"]') as HTMLElement;
    expect(row.className).toMatch(/border-l-2/);
  });
});
