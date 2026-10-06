// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  IntegrationHealthPanel,
  retryOutcomeCopy,
} from "@/components/memory/integration-health";
import type { MemoryHealthView } from "@/components/memory/query-options";

const organizationId = "11111111-1111-4111-8111-111111111111";
const captureId = "22222222-2222-4222-8222-222222222222";

function healthView(overrides: Partial<MemoryHealthView> = {}): MemoryHealthView {
  return {
    organizationId,
    serverTime: "2026-09-12T00:00:00.000Z",
    adapters: [
      {
        sourceKind: "channel_finding",
        registered: true,
        pending: 3,
        claimed: 1,
        completed: 9,
        failed: 2,
        quarantined: 0,
        obsolete: 1,
        backlog: 4,
        retryable: 2,
        lastSuccessAt: "2026-09-11T10:00:00.000Z",
      },
    ],
    contexts: [
      {
        purpose: "channel_advice",
        ready: 5,
        empty: 0,
        partial: 1,
        unavailable: 0,
        disabled: 0,
        total: 6,
        lastPreparedAt: "2026-09-11T12:00:00.000Z",
      },
    ],
    embeddingBacklog: 7,
    canRetry: true,
    canConfigure: true,
    ...overrides,
  };
}

function renderPanel(input: {
  role?: "owner" | "admin" | "operator" | "viewer";
  health?: MemoryHealthView;
  healthError?: boolean;
  retryTargets?: { captureId: string; sourceKind: string }[];
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const fetchHealth = input.healthError
    ? () => Promise.reject(new Error("unreachable"))
    : () => Promise.resolve({ health: input.health ?? healthView() });
  render(
    <QueryClientProvider client={queryClient}>
      <IntegrationHealthPanel
        organizationId={organizationId}
        role={input.role ?? "owner"}
        retryTargets={input.retryTargets}
        fetchHealth={fetchHealth}
      />
    </QueryClientProvider>,
  );
  return queryClient;
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => cleanup());

describe("IntegrationHealthPanel", () => {
  it("shows backlog as pending with real counts, never a silent success", async () => {
    renderPanel();

    expect(await screen.findByText("channel_finding")).toBeVisible();
    expect(screen.getByText("4 pending")).toBeVisible();
    expect(screen.getByText(/9 completed/)).toBeVisible();
    expect(screen.getByText(/2 failed/)).toBeVisible();
    expect(screen.queryByText("Up to date")).not.toBeInTheDocument();
    expect(screen.getByText(/5 ready/)).toBeVisible();
    expect(screen.getByText(/7 awaiting embedding/)).toBeVisible();
  });

  it("reports an empty queue honestly instead of a healthy one", async () => {
    renderPanel({ health: healthView({ adapters: [], contexts: [], embeddingBacklog: 0 }) });

    expect(
      await screen.findByText(/empty queue, not a healthy one/),
    ).toBeVisible();
    expect(screen.getByText(/No context has been prepared yet/)).toBeVisible();
    expect(screen.queryByText("Up to date")).not.toBeInTheDocument();
  });

  it("hides retry affordances from viewers even with concrete targets", async () => {
    renderPanel({
      role: "viewer",
      retryTargets: [{ captureId, sourceKind: "channel_finding" }],
    });

    expect(await screen.findByText("channel_finding")).toBeVisible();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("hides retry affordances from operators, who hold no retry permission", async () => {
    renderPanel({
      role: "operator",
      retryTargets: [{ captureId, sourceKind: "channel_finding" }],
    });

    expect(await screen.findByText("channel_finding")).toBeVisible();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("shows no retry buttons without concrete targets, even for owners", async () => {
    renderPanel({ role: "owner" });

    expect(await screen.findByText("channel_finding")).toBeVisible();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("reports a refused retry without new-success copy", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((async () =>
      jsonResponse(
        { error: { code: "CONFLICT", message: "This capture is not retryable." } },
        409,
      )) as typeof fetch);
    renderPanel({
      role: "owner",
      retryTargets: [{ captureId, sourceKind: "channel_finding" }],
    });

    fireEvent.click(await screen.findByRole("button", { name: /retry/i }));

    await waitFor(() =>
      expect(screen.getByText(/Retry refused/)).toBeVisible(),
    );
    expect(screen.getByText(/This capture is not retryable/)).toBeVisible();
    expect(screen.getByText(/Nothing changed/)).toBeVisible();
    expect(screen.queryByText("Retry started")).not.toBeInTheDocument();
  });

  it("reports a replayed retry without new-success copy", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((async () =>
      jsonResponse({ captureId, status: "pending", replayed: true })) as typeof fetch);
    renderPanel({
      role: "owner",
      retryTargets: [{ captureId, sourceKind: "channel_finding" }],
    });

    fireEvent.click(await screen.findByRole("button", { name: /retry/i }));

    await waitFor(() =>
      expect(screen.getByText(/Already retried/)).toBeVisible(),
    );
    expect(screen.queryByText("Retry started")).not.toBeInTheDocument();
  });

  it("admits an unavailable health read instead of zero counts", async () => {
    renderPanel({ healthError: true });

    expect(
      await screen.findByText(/Connection health is not available yet/),
    ).toBeVisible();
    expect(screen.getByText(/backlog is unknown rather than zero/)).toBeVisible();
  });
});

describe("retryOutcomeCopy", () => {
  it("reserves success copy for a fresh retry only", () => {
    expect(retryOutcomeCopy({ status: "retried" }).success).toBe(true);
    expect(retryOutcomeCopy({ status: "replayed" }).success).toBe(false);
    expect(retryOutcomeCopy({ status: "refused", reason: "No." }).success).toBe(false);
  });
});
