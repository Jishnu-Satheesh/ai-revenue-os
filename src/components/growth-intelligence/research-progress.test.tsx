// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ResearchProgress,
  useResearchPipeline,
} from "@/components/growth-intelligence/research-progress";
import type { ResearchPipelineView } from "@/modules/growth-intelligence/application/research-read-model";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";
const BRANCH = "20000000-0000-4000-8000-00000000000a";
const PIPELINE = "40000000-0000-4000-8000-000000000004";

function pipeline(overrides: Partial<ResearchPipelineView> = {}): ResearchPipelineView {
  return {
    pipelineId: PIPELINE,
    organizationId: ORGANIZATION,
    branchId: BRANCH,
    scopeLabel: "Downtown",
    legacyScope: false,
    stage: "researching",
    stageDisplay: "Researching",
    active: true,
    observedAt: "2026-09-08T06:00:00Z",
    stageChangedAt: "2026-09-08T06:05:00Z",
    settingsSummary: {
      schemaVersion: 2,
      topics: ["Local dining demand", "Seasonal events"],
      competitorNames: ["Rival Kitchen"],
      city: "Dubai",
      countryCode: "AE",
    },
    settingsMatchCurrent: true,
    coverage: [
      { slotKey: "local_market", kind: "local_market", outcome: "supported" },
      {
        slotKey: "topic:local_dining_demand",
        kind: "topic",
        outcome: "searched_no_usable_evidence",
      },
    ] as ResearchPipelineView["coverage"],
    sourceCount: 3,
    claimCount: 1,
    sources: [],
    safeFailureCode: null,
    retry: { eligible: false, reason: "Research is still running; retry is not available yet." },
    outcomeLinks: {
      self: `/api/organizations/${ORGANIZATION}/market-profile/research/${PIPELINE}`,
      retry: null,
      workspace: null,
    },
    ...overrides,
  };
}

function researchPayload(active: ResearchPipelineView | null) {
  return {
    research: {
      branchId: BRANCH,
      active,
      history: { pipelines: [], nextCursor: null },
      lastSuccess: null,
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-4000-8000-000000000000" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function probe(initialActive: ResearchPipelineView | null, fetchImpl: (url: string) => unknown) {
  const fetchMock = vi.fn(async (url: string) => fetchImpl(url));
  vi.stubGlobal("fetch", fetchMock);
  function Probe() {
    const state = useResearchPipeline({
      organizationId: ORGANIZATION,
      branchId: BRANCH,
      initialActive,
    });
    return (
      <div>
        <span data-testid="stage">{state.active?.stage ?? "none"}</span>
        <span data-testid="status">{state.status}</span>
      </div>
    );
  }
  render(<Probe />);
  return fetchMock;
}

describe("ResearchProgress", () => {
  it("shows Preparing insights while evidence is saved and analysis is still pending", () => {
    render(
      <ResearchProgress
        organizationId={ORGANIZATION}
        pipeline={pipeline({ stage: "preparing_insights", stageDisplay: "Preparing insights" })}
        timeZone="Asia/Dubai"
      />,
    );
    expect(screen.getByText("Preparing insights")).toBeTruthy();
    expect(screen.getByText(/2 searched/i)).toBeTruthy();
    expect(screen.getByText(/3 sources/i)).toBeTruthy();
  });

  it("keeps findings visible during preparing_insights with settings and time", () => {
    render(
      <ResearchProgress
        organizationId={ORGANIZATION}
        pipeline={pipeline({ stage: "preparing_insights", stageDisplay: "Preparing insights" })}
        timeZone="Asia/Dubai"
      />,
    );
    expect(screen.getByText(/local dining demand/i)).toBeTruthy();
    expect(screen.getByText(/downtown/i)).toBeTruthy();
  });

  it("reports Status unavailable on network error instead of research failure", () => {
    render(
      <ResearchProgress
        organizationId={ORGANIZATION}
        pipeline={null}
        timeZone="Asia/Dubai"
        loadError="network"
      />,
    );
    expect(screen.getByText(/status unavailable/i)).toBeTruthy();
    expect(screen.queryByText(/could not finish/i)).toBeNull();
  });
});

describe("useResearchPipeline", () => {
  it("polls every 5 seconds while the pipeline is active", async () => {
    const fetchMock = probe(
      pipeline(),
      async () => new Response(JSON.stringify(researchPayload(pipeline())), { status: 200 }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("stops polling once the pipeline reaches a terminal stage", async () => {
    const fetchMock = probe(
      pipeline(),
      async () =>
        new Response(
          JSON.stringify(
            researchPayload(pipeline({ stage: "ready", stageDisplay: "Ready", active: false })),
          ),
          { status: 200 },
        ),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("backs off to 30 seconds after a read error and recovers on the next read", async () => {
    let calls = 0;
    const fetchMock = probe(pipeline(), async () => {
      calls += 1;
      if (calls === 1) throw new Error("offline");
      return new Response(JSON.stringify(researchPayload(pipeline())), { status: 200 });
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("pauses while the tab is hidden and rechecks immediately on return", async () => {
    const fetchMock = probe(
      pipeline(),
      async () => new Response(JSON.stringify(researchPayload(pipeline())), { status: 200 }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never lets an older branch response overwrite the current branch", async () => {
    let resolveFirst!: (value: Response) => void;
    const first = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("branch-one")) return first;
      return new Response(JSON.stringify(researchPayload(null)), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    function Probe({ branchId }: { branchId: string }) {
      const state = useResearchPipeline({
        organizationId: ORGANIZATION,
        branchId,
        initialActive: pipeline(),
      });
      return <span data-testid="stage">{state.active?.stage ?? "none"}</span>;
    }
    const utils = render(<Probe branchId="branch-one" />);
    utils.rerender(<Probe branchId="branch-two" />);
    resolveFirst(new Response(JSON.stringify(researchPayload(pipeline())), { status: 200 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByTestId("stage").textContent).toBe("none");
  });

  it("notifies once when analysis reaches preparing_insights and once per terminal outcome", async () => {
    const transitions: string[] = [];
    function Probe() {
      const state = useResearchPipeline({
        organizationId: ORGANIZATION,
        branchId: BRANCH,
        initialActive: pipeline(),
        onTransition: (next) => {
          transitions.push(next.stage);
        },
      });
      return <span data-testid="stage">{state.active?.stage ?? "none"}</span>;
    }
    let stage: ResearchPipelineView = pipeline({
      stage: "preparing_insights",
      stageDisplay: "Preparing insights",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(researchPayload(stage)), { status: 200 })),
    );
    render(<Probe />);
    await vi.advanceTimersByTimeAsync(0);
    expect(transitions).toEqual(["preparing_insights"]);
    stage = pipeline({ stage: "ready", stageDisplay: "Ready", active: false });
    await vi.advanceTimersByTimeAsync(5000);
    expect(transitions).toEqual(["preparing_insights", "ready"]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(transitions).toEqual(["preparing_insights", "ready"]);
  });

  it("includes organization, branch and pipeline in the status request", async () => {
    const fetchMock = probe(
      pipeline(),
      async () => new Response(JSON.stringify(researchPayload(pipeline())), { status: 200 }),
    );
    await vi.advanceTimersByTimeAsync(0);
    const url = (fetchMock.mock.calls[0] as unknown[])[0] as string;
    expect(url).toContain(ORGANIZATION);
    expect(url).toContain(BRANCH);
  });
});
