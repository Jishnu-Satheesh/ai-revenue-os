// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ResearchOutcomes } from "@/components/growth-intelligence/research-outcomes";
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
    stage: "ready",
    stageDisplay: "Ready",
    active: false,
    observedAt: "2026-09-08T06:00:00Z",
    stageChangedAt: "2026-09-08T06:05:00Z",
    settingsSummary: {
      schemaVersion: 2,
      topics: ["Local dining demand"],
      competitorNames: [],
      city: "Dubai",
      countryCode: "AE",
    },
    settingsMatchCurrent: true,
    coverage: [],
    sourceCount: 2,
    claimCount: 1,
    sources: [
      {
        id: "source-1",
        url: "https://example.com/market-note",
        domain: "example.com",
        publisher: "Example Press",
        sourceClass: "public_signal",
        availability: "available",
        retrievedAt: "2026-09-08T06:00:00Z",
        publishedAt: null,
        observedAt: null,
      },
    ],
    safeFailureCode: null,
    retry: { eligible: false, reason: "Insights already finished; no retry is needed." },
    outcomeLinks: {
      self: `/api/organizations/${ORGANIZATION}/market-profile/research/${PIPELINE}`,
      retry: null,
      workspace: `/organizations/${ORGANIZATION}/growth-intelligence#insights`,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
  );
  vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-4000-8000-000000000000" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ResearchOutcomes", () => {
  it("links each outcome to its exact status path and the workspace insights view", () => {
    render(
      <ResearchOutcomes
        organizationId={ORGANIZATION}
        history={[pipeline()]}
        lastSuccess={null}
        canManage
      />,
    );
    const status = screen.getByRole("link", { name: /view status/i });
    expect(status.getAttribute("href")).toBe(
      `/api/organizations/${ORGANIZATION}/market-profile/research/${PIPELINE}`,
    );
    expect(screen.getByRole("link", { name: /open in insights/i }).getAttribute("href")).toBe(
      `/organizations/${ORGANIZATION}/growth-intelligence#insights`,
    );
  });

  it("offers an eligible retry for synthesis failure and hides it once finished", async () => {
    const failed = pipeline({
      stage: "synthesis_failed",
      stageDisplay: "Research saved; insights could not finish",
      active: false,
      safeFailureCode: "SYNTHESIS_FAILED",
      retry: { eligible: true, reason: null },
      outcomeLinks: {
        self: `/api/organizations/${ORGANIZATION}/market-profile/research/${PIPELINE}`,
        retry: `/api/organizations/${ORGANIZATION}/market-profile/research/${PIPELINE}/retry`,
        workspace: `/organizations/${ORGANIZATION}/growth-intelligence#insights`,
      },
    });
    render(
      <ResearchOutcomes
        organizationId={ORGANIZATION}
        history={[failed]}
        lastSuccess={null}
        canManage
      />,
    );
    const retry = screen.getByRole("button", { name: /retry analysis/i });
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByText(/retry requested/i)).toBeTruthy());
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe(
      `/api/organizations/${ORGANIZATION}/market-profile/research/${PIPELINE}/retry`,
    );
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      idempotencyKey: "00000000-0000-4000-8000-000000000000",
    });

    cleanup();
    render(
      <ResearchOutcomes
        organizationId={ORGANIZATION}
        history={[pipeline()]}
        lastSuccess={null}
        canManage
      />,
    );
    expect(screen.queryByRole("button", { name: /retry analysis/i })).toBeNull();
  });

  it("keeps findings after synthesis failure with prior settings marked", () => {
    render(
      <ResearchOutcomes
        organizationId={ORGANIZATION}
        history={[]}
        lastSuccess={pipeline({
          stage: "synthesis_failed",
          stageDisplay: "Research saved; insights could not finish",
          settingsMatchCurrent: false,
        })}
        canManage
      />,
    );
    expect(screen.getByText(/earlier research settings/i)).toBeTruthy();
    expect(screen.getByText(/insights could not finish/i)).toBeTruthy();
  });

  it("marks erased sources without exposing stored content", () => {
    render(
      <ResearchOutcomes
        organizationId={ORGANIZATION}
        history={[
          pipeline({
            sources: [
              {
                id: "source-9",
                url: "https://example.com/removed",
                domain: "example.com",
                publisher: "Example Press",
                sourceClass: "public_signal",
                availability: "source-unavailable",
                retrievedAt: "2026-09-08T06:00:00Z",
                publishedAt: null,
                observedAt: null,
              },
            ],
          }),
        ]}
        lastSuccess={null}
        canManage
      />,
    );
    expect(screen.getByText(/source evidence no longer available/i)).toBeTruthy();
  });

  it("shows retained history with prior settings instead of current support", () => {
    render(
      <ResearchOutcomes
        organizationId={ORGANIZATION}
        history={[
          pipeline(),
          pipeline({
            pipelineId: "40000000-0000-4000-8000-000000000009",
            stageChangedAt: "2026-09-01T06:00:00Z",
            settingsMatchCurrent: false,
            settingsSummary: {
              schemaVersion: 2,
              topics: ["Old topic"],
              competitorNames: [],
              city: "Dubai",
              countryCode: "AE",
            },
          }),
        ]}
        lastSuccess={null}
        canManage
      />,
    );
    expect(screen.getByText(/old topic/i)).toBeTruthy();
    expect(screen.getByText(/earlier research settings/i)).toBeTruthy();
  });
});
