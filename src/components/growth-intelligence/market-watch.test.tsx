// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { MarketWatch } from "@/components/growth-intelligence/market-watch";
import type {
  MarketWatchSignal,
  MarketWatchView,
} from "@/modules/growth-intelligence/application/market-watch";

const fetchMock = vi.fn(
  async () => new Response(JSON.stringify({ request: { requestId: "r1" } }), { status: 200 }),
);

function signal(overrides: Partial<MarketWatchSignal> = {}): MarketWatchSignal {
  return {
    claimId: "claim-1",
    subjectKind: "market",
    subjectRef: "dubai-market",
    claimKind: "demand_signal",
    paraphrase: "A public market signal may affect local demand.",
    quotation: null,
    geographicLayer: "city",
    geographyRef: "ae:du",
    supportGrade: "primary",
    freshness: "current",
    state: "current",
    expired: false,
    sources: [
      {
        url: "https://tourism.example/dubai-notice",
        publisher: "Dubai Tourism",
        sourceClass: "official",
        retrievedAt: "2026-09-01T10:00:00Z",
        publishedAt: null,
        observedAt: "2026-09-01T09:00:00Z",
      },
    ],
    limitations: ["BROADER_MARKET_INFERENCE"],
    retrievedAt: "2026-09-01T10:00:00Z",
    ...overrides,
  };
}

function watch(overrides: Partial<MarketWatchView> = {}): MarketWatchView {
  return {
    signals: [signal()],
    nextCursor: null,
    profileStatus: { state: "ready", currentVersionId: "v1", delayedReason: null },
    retryableRequests: [],
    ...overrides,
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

describe("MarketWatch", () => {
  it("renders signals with text-and-icon state, grade, freshness, and limitations", () => {
    render(<MarketWatch organizationId="org-1" watch={watch()} canRetry={false} />);

    expect(screen.getByText(/A public market signal may affect local demand/)).toBeTruthy();
    expect(screen.getByText("Current")).toBeTruthy();
    expect(screen.getByText(/primary/i)).toBeTruthy();
    expect(screen.getByText(/BROADER_MARKET_INFERENCE/)).toBeTruthy();
    expect(screen.getByText(/ae:du/)).toBeTruthy();
  });

  it("distinguishes stale, conflicted, withdrawn, and excluded signals", () => {
    render(
      <MarketWatch
        organizationId="org-1"
        watch={watch({
          signals: [
            signal({ claimId: "s1", state: "stale", freshness: "stale" }),
            signal({ claimId: "s2", state: "conflicted", supportGrade: "conflicted" }),
            signal({ claimId: "s3", state: "withdrawn" }),
            signal({ claimId: "s4", state: "excluded" }),
          ],
        })}
        canRetry={false}
      />,
    );

    expect(screen.getByText("Stale")).toBeTruthy();
    expect(screen.getByText("Conflicted")).toBeTruthy();
    expect(screen.getByText("Withdrawn")).toBeTruthy();
    expect(screen.getByText("Excluded")).toBeTruthy();
  });

  it("shows the delayed reason instead of an all-clear when evidence is missing", () => {
    render(
      <MarketWatch
        organizationId="org-1"
        watch={watch({
          signals: [],
          profileStatus: {
            state: "ready",
            currentVersionId: "v1",
            delayedReason: "Market Watch is delayed: research is still running.",
          },
        })}
        canRetry={false}
      />,
    );

    expect(screen.getByText(/delayed: research is still running/)).toBeTruthy();
    expect(screen.queryByText(/no eligible market evidence/i)).toBeNull();
  });

  it("offers operator retry for failed requests and hides it from viewers", async () => {
    const retryable = watch({
      retryableRequests: [
        {
          requestId: "req-1",
          kind: "market_research",
          status: "failed",
          safeFailureCode: "ADAPTER_UNAVAILABLE",
        },
      ],
    });
    const { unmount } = render(
      <MarketWatch organizationId="org-1" watch={retryable} canRetry={true} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /retry request/i }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/organizations/org-1/growth-intelligence/requests/req-1/retry",
      expect.objectContaining({ method: "POST" }),
    );
    unmount();

    render(<MarketWatch organizationId="org-1" watch={retryable} canRetry={false} />);
    expect(screen.queryByRole("button", { name: /retry request/i })).toBeNull();
  });

  it("shows an explicit success state after a retry completes", async () => {
    const retryable = watch({
      retryableRequests: [
        {
          requestId: "req-1",
          kind: "market_research",
          status: "failed",
          safeFailureCode: "ADAPTER_UNAVAILABLE",
        },
      ],
    });
    render(<MarketWatch organizationId="org-1" watch={retryable} canRetry={true} />);
    fireEvent.click(screen.getByRole("button", { name: /retry request/i }));
    await waitFor(() => expect(screen.getByText(/retry requested/i)).toBeTruthy());
    expect(refresh).toHaveBeenCalled();
  });
});

describe("MarketWatch review entry", () => {
  it("opens the Review market monitoring dialog from Market Watch", () => {
    const opened: string[] = [];
    const listener = (event: Event) => {
      opened.push(event.type);
    };
    window.addEventListener("growth-intelligence:open-market-monitoring", listener);
    try {
      render(<MarketWatch organizationId="org-1" watch={watch()} canRetry={false} />);
      fireEvent.click(screen.getByRole("button", { name: /review market monitoring/i }));
      expect(opened).toEqual(["growth-intelligence:open-market-monitoring"]);
    } finally {
      window.removeEventListener("growth-intelligence:open-market-monitoring", listener);
    }
  });
});
