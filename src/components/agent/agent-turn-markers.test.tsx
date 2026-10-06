// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AgentTurnMarkers } from "@/components/agent/agent-turn-markers";

const organizationId = "10000000-0000-4000-8000-000000000001";
const channelId = "20000000-0000-4000-8000-000000000002";
const runId = "30000000-0000-4000-8000-000000000003";

describe("durable agent turn markers", () => {
  it("renders a stored period switch as an icon separator outside the answer", () => {
    const { container } = render(<AgentTurnMarkers organizationId={organizationId} events={[{
      id: "event-1", turnId: "turn-1", seq: 1, type: "period_switched",
      payload: { requestedStart: "2026-09-01", requestedEnd: "2026-09-30", selectedStart: "2026-08-01", selectedEnd: "2026-08-31", reason: "The requested period has no usable governed report." },
      occurredAt: "2026-10-03T00:00:00Z",
    }]} />);
    expect(screen.getByText(/Switched from Sep 1–30, 2026 to Aug 1–31, 2026/i)).toBeInTheDocument();
    expect(container.querySelector('[data-slot="marker"][data-variant="separator"]')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="marker-icon"] svg')).toBeInTheDocument();
  });

  it("links only a same-organization exact audit run after completion", () => {
    render(<AgentTurnMarkers organizationId={organizationId} events={[{
      id: "event-2", turnId: "turn-1", seq: 2, type: "analysis_completed",
      payload: { channelId, runId, auditHref: `/organizations/${organizationId}/channels/${channelId}?runId=${runId}` },
      occurredAt: "2026-10-03T00:00:00Z",
    }, {
      id: "event-3", turnId: "turn-1", seq: 3, type: "analysis_completed",
      payload: { channelId, runId, auditHref: "https://other.example.com" },
      occurredAt: "2026-10-03T00:00:01Z",
    }]} />);
    expect(screen.getByRole("link", { name: /Open exact channel audit/i })).toHaveAttribute("href", `/organizations/${organizationId}/channels/${channelId}?runId=${runId}`);
    expect(screen.getAllByText(/Channel analysis complete/i)).toHaveLength(2);
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});
