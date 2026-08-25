// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { RecommendationControls } from "@/components/analysis/recommendation-controls";
import type { WorkspaceRecommendationView } from "@/modules/analysis/application/read-model";

const fetchMock = vi.fn(async () => new Response(JSON.stringify({ recommendationId: "rec-1" }), { status: 200 }));

function recommendation(
  overrides: Partial<WorkspaceRecommendationView> = {},
): WorkspaceRecommendationView {
  return {
    id: "rec-1",
    label: "recommendation",
    headline: "Mark items out of stock before service",
    detail:
      "Every cancellation in this window was ITEM_UNAVAILABLE. Telling the app which items ran out keeps the order from being taken at all.",
    supportedActions: ["Mark unavailable items in the app before service"],
    limitations: ["Twenty of fifty-nine days carried evidence."],
    citationFindingIds: ["finding-1"],
    decision: null,
    myFeedback: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  refresh.mockClear();
  fetchMock.mockClear();
});

describe("RecommendationControls", () => {
  it("renders the narration with its label and limitations", () => {
    render(<RecommendationControls organizationId="org-1" recommendation={recommendation()} />);
    expect(screen.getByText("Recommendation")).toBeTruthy();
    expect(screen.getByText(/Mark items out of stock before service/)).toBeTruthy();
    expect(screen.getByText(/Twenty of fifty-nine days carried evidence/)).toBeTruthy();
  });

  it("posts an acknowledgement to the decisions route and refreshes", async () => {
    render(<RecommendationControls organizationId="org-1" recommendation={recommendation()} />);
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const call = vi.mocked(fetch).mock.calls[0]!;
    expect(call[0]).toBe("/api/organizations/org-1/channel-recommendations/rec-1/decisions");
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({
      decision: "acknowledged",
    });
  });

  it("keeps dismissal submit disabled until the reason is three characters", () => {
    render(<RecommendationControls organizationId="org-1" recommendation={recommendation()} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    const reason = screen.getByLabelText("Dismissal reason") as HTMLTextAreaElement;
    const submit = screen.getByRole("dialog", {}).querySelector("button[type='button']:last-child")!;
    fireEvent.change(reason, { target: { value: "no" } });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(reason, { target: { value: "not our situation" } });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
  });

  it("replaces controls with the recorded answer once one exists", () => {
    render(
      <RecommendationControls
        organizationId="org-1"
        recommendation={recommendation({
          decision: {
            decision: "planned",
            reason: null,
            actorName: "Sara",
            createdAt: "2026-08-24T10:00:00Z",
          },
        })}
      />,
    );
    expect(screen.queryByRole("button", { name: "Acknowledge" })).toBeNull();
    expect(screen.getByText(/Marked planned · Sara ·/)).toBeTruthy();
  });

  it("shows a dismissed answer's recorded reason", () => {
    render(
      <RecommendationControls
        organizationId="org-1"
        recommendation={recommendation({
          decision: {
            decision: "dismissed",
            reason: "We already do this offline",
            actorName: "Omar",
            createdAt: "2026-08-24T10:00:00Z",
          },
        })}
      />,
    );
    expect(screen.getByText(/We already do this offline/)).toBeTruthy();
  });

  it("reflects the member's own feedback vote", () => {
    render(
      <RecommendationControls
        organizationId="org-1"
        recommendation={recommendation({ myFeedback: true })}
      />,
    );
    expect(screen.getByRole("button", { name: /Helpful/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(
      screen.getByRole("button", { name: /Not helpful/ }).getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("posts the vote to the feedback route", async () => {
    render(<RecommendationControls organizationId="org-1" recommendation={recommendation()} />);
    fireEvent.click(screen.getByRole("button", { name: /Not helpful/ }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const call = vi.mocked(fetch).mock.calls[0]!;
    expect(call[0]).toBe("/api/organizations/org-1/channel-recommendations/rec-1/feedback");
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ helpful: false });
  });

  it("keeps the dialog open and the words intact when the server refuses the dismissal", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "no" }), { status: 403 }),
    );
    render(<RecommendationControls organizationId="org-1" recommendation={recommendation()} />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    const reason = screen.getByLabelText("Dismissal reason") as HTMLTextAreaElement;
    fireEvent.change(reason, { target: { value: "not our situation" } });
    const dialog = screen.getByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: "Dismiss" });
    fireEvent.click(submit);

    await waitFor(
      () => expect(screen.getByRole("alert").textContent).toContain("cannot record"),
      { timeout: 4_000 },
    );
    // The refusal keeps both the words and their window.
    expect((screen.getByLabelText("Dismissal reason") as HTMLTextAreaElement).value).toBe(
      "not our situation",
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("never carries the forbidden legacy labels", () => {
    const { container } = render(
      <RecommendationControls organizationId="org-1" recommendation={recommendation()} />,
    );
    expect(container.textContent).not.toContain("Evidence Node");
    expect(container.textContent).not.toContain("Action Queue");
  });
});
