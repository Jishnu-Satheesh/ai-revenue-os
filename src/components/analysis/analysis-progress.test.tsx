// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AnalysisProgress } from "@/components/analysis/analysis-progress";

const ORGANIZATION = "44444444-4444-4444-8444-444444444444";
const CHANNEL = "55555555-5555-4555-8555-555555555555";

function stage(value: string) {
  return { ok: true, json: async () => ({ stage: value, analysisRunId: null }) } as Response;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup(responses: Response[]) {
  const fetchMock = vi.fn();
  responses.forEach((response) => fetchMock.mockResolvedValueOnce(response));
  fetchMock.mockResolvedValue(responses[responses.length - 1]);
  vi.stubGlobal("fetch", fetchMock);
  const onReady = vi.fn();
  render(
    <AnalysisProgress
      organizationId={ORGANIZATION}
      channelId={CHANNEL}
      window={{ from: "2026-01-01", to: "2026-01-04" }}
      onReady={onReady}
      pollMs={10}
    />,
  );
  return { fetchMock, onReady };
}

describe("the analysis loader", () => {
  it("says it is reading the reports before a run exists", async () => {
    setup([stage("queued")]);

    expect(await screen.findByText(/reading approved reports/i)).toBeInTheDocument();
  });

  it("advances to the checks when the run starts", async () => {
    setup([stage("queued"), stage("running")]);

    expect(await screen.findByText(/running the checks/i)).toBeInTheDocument();
  });

  it("advances to the narration when the counting finishes", async () => {
    // Two distinct stages because they are two distinct Trigger tasks. An
    // operator watching a bar that stops moving deserves to know the second
    // one has started.
    setup([stage("running"), stage("narrating")]);

    expect(await screen.findByText(/writing recommendations/i)).toBeInTheDocument();
  });

  it("tells the page when the result is ready, and stops polling", async () => {
    const { onReady, fetchMock } = setup([stage("narrating"), stage("ready")]);

    await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));
    const callsAtReady = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchMock.mock.calls.length).toBe(callsAtReady);
  });

  it("says plainly when the run failed, rather than spinning forever", async () => {
    setup([stage("failed")]);

    expect(await screen.findByText(/could not be completed/i)).toBeInTheDocument();
  });

  it("keeps polling through a transient network failure", async () => {
    // The run is still going; a dropped poll is not a failed analysis.
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(stage("running"));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AnalysisProgress
        organizationId={ORGANIZATION}
        channelId={CHANNEL}
        window={{ from: "2026-01-01", to: "2026-01-04" }}
        onReady={vi.fn()}
        pollMs={10}
      />,
    );

    expect(await screen.findByText(/running the checks/i)).toBeInTheDocument();
  });

  it("polls the window it was given", async () => {
    const { fetchMock } = setup([stage("queued")]);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("from=2026-01-01&to=2026-01-04"),
        expect.anything(),
      ),
    );
  });
});
