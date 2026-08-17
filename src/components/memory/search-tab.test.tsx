// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { MemoryWorkspaceClient } from "@/components/memory/memory-workspace-client";
import { memoryQueryKeys } from "@/components/memory/query-options";
import type { MemoryRetrievalResponse, MemoryRetrievalResult } from "@/domain/memory/schemas";
import type { OrganizationRole } from "@/domain/organizations/types";
import type { MemoryItemDetail, MemorySnapshot } from "@/modules/memory/application/service";

const organizationId = "11111111-1111-4111-8111-111111111111";
const otherOrganizationId = "99999999-9999-4999-8999-999999999999";
const verifiedItemId = "22222222-2222-4222-8222-222222222222";
const inferredItemId = "33333333-3333-4333-8333-333333333333";
const supersededItemId = "44444444-4444-4444-8444-444444444444";
const serverTime = "2026-08-09T12:00:00.000Z";

function verifiedResult(overrides: Partial<MemoryRetrievalResult> = {}): MemoryRetrievalResult {
  return {
    itemId: verifiedItemId,
    memoryType: "note",
    title: "Weekend brunch service starts at 09:00",
    body: "Confirmed with the general manager during the August service review.",
    provenance: {
      origin: "user_verified",
      sourceTier: 1,
      sourceSystem: "operator_console",
      sourceReference: "review-2026-08",
      verificationState: "verified",
      verifiedAt: "2026-08-08T09:00:00.000Z",
      confidence: 0.95,
    },
    trustRank: 0,
    freshness: "fresh",
    observedAt: "2026-08-08T09:00:00.000Z",
    sensitivity: "internal",
    scores: { lexical: 0.8, semantic: 0.6, blended: 0.72 },
    ...overrides,
  };
}

function inferredResult(overrides: Partial<MemoryRetrievalResult> = {}): MemoryRetrievalResult {
  return {
    itemId: inferredItemId,
    memoryType: "lesson",
    title: "Brunch demand may be rising on public holidays",
    body: "Model inference from three delivery reports.",
    provenance: {
      origin: "ai_proposed",
      sourceTier: 5,
      verificationState: "unverified",
    },
    trustRank: 4,
    freshness: "stale",
    sensitivity: "internal",
    scores: { lexical: 0.2, semantic: 0.4, blended: 0.31 },
    ...overrides,
  };
}

function searchResponse(
  overrides: Partial<MemoryRetrievalResponse> = {},
): MemoryRetrievalResponse & { servedFromCache: false } {
  return {
    results: [verifiedResult()],
    retrievalMode: "hybrid",
    servedFromCache: false,
    serverTime,
    ...overrides,
  } as MemoryRetrievalResponse & { servedFromCache: false };
}

function snapshot(overrides: Partial<MemorySnapshot> = {}): MemorySnapshot {
  return {
    counts: {
      byType: { note: 8, lesson: 3 },
      byVerificationState: { verified: 7, unverified: 4 },
      bySensitivity: { internal: 11 },
      reviewQueueDepth: 2,
      embeddingBacklog: 1,
      total: 11,
    },
    recent: [],
    reviewQueue: [],
    branches: [],
    ceiling: "confidential",
    serverTime,
    ...overrides,
  };
}

function itemDetail(): MemoryItemDetail {
  return {
    item: {
      id: verifiedItemId,
      memoryType: "note",
      title: "Weekend brunch service starts at 09:00",
      body: "Confirmed with the general manager during the August service review.",
      origin: "user_verified",
      sourceTier: 1,
      sourceSystem: "operator_console",
      verificationState: "verified",
      sensitivity: "internal",
      confidence: 0.95,
      trustRank: 0,
      freshness: "fresh",
      observedAt: "2026-08-08T09:00:00.000Z",
      embeddingStatus: "ready",
      verifiedAt: "2026-08-08T09:00:00.000Z",
      createdAt: "2026-08-07T09:00:00.000Z",
    },
    chain: [
      {
        id: supersededItemId,
        memoryType: "note",
        title: "Weekend brunch service starts at 10:00",
        origin: "provider_imported",
        sourceTier: 2,
        verificationState: "unverified",
        sensitivity: "internal",
        trustRank: 2,
        freshness: "superseded",
        supersededById: verifiedItemId,
        supersessionReason: "Opening time corrected after the service review.",
        embeddingStatus: "ready",
        createdAt: "2026-07-01T09:00:00.000Z",
      },
    ],
    links: [
      {
        id: "55555555-5555-4555-8555-555555555555",
        relation: "derived_from",
        direction: "from",
        relatedItemId: supersededItemId,
      },
    ],
    currentFact: null,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    json: async () => body,
  } as unknown as Response;
}

/**
 * Routes each mocked call by URL so a test can describe the workspace's server
 * responses without depending on the order the client happens to fetch in.
 */
function mockApi(routes: {
  snapshot?: MemorySnapshot;
  search?: MemoryRetrievalResponse;
  item?: MemoryItemDetail;
  searchStatus?: number;
  searchError?: { code: string; message: string };
  onSearch?: (body: unknown) => void;
}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = String(input);
    if (url.endsWith("/memory/search")) {
      routes.onSearch?.(JSON.parse(String(init?.body ?? "{}")));
      if (routes.searchError) {
        return jsonResponse({ error: routes.searchError }, routes.searchStatus ?? 403);
      }
      return jsonResponse(routes.search ?? searchResponse());
    }
    if (url.includes("/memory/items/")) {
      return jsonResponse(routes.item ?? itemDetail());
    }
    return jsonResponse({ snapshot: routes.snapshot ?? snapshot() });
  }) as typeof fetch);
}

function renderWorkspace(
  options: {
    snapshot?: MemorySnapshot;
    role?: OrganizationRole;
  } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryWorkspaceClient
        organizationId={organizationId}
        organizationName="Fixture Bakery"
        role={options.role ?? "operator"}
        initialSnapshot={options.snapshot ?? snapshot()}
        initialDataUpdatedAt={Date.now()}
      />
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

function submitSearch(query = "brunch service") {
  fireEvent.change(screen.getByRole("searchbox", { name: /search business memory/i }), {
    target: { value: query },
  });
  fireEvent.click(screen.getByRole("button", { name: /^Search memory$/i }));
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => cleanup());

describe("Business Memory search workspace", () => {
  it("keeps lexical results visible and labels degraded retrieval", async () => {
    mockApi({
      search: searchResponse({
        retrievalMode: "lexical",
        degradedReason: "EMBEDDING_TIMEOUT",
        results: [verifiedResult()],
      }),
    });
    renderWorkspace();
    submitSearch();

    const degraded = await screen.findByRole("alert", {
      name: /semantic retrieval is unavailable/i,
    });
    expect(degraded).toBeVisible();
    expect(degraded).toHaveTextContent(/keyword/i);
    // The degrade notice must never replace the results it qualifies.
    expect(await screen.findByText("Weekend brunch service starts at 09:00")).toBeVisible();
  });

  it("opens Inspect chain in a labelled dialog and restores focus on close", async () => {
    const fetchSpy = mockApi({});
    renderWorkspace();
    submitSearch();

    const trigger = await screen.findByRole("button", { name: /inspect chain/i });
    // Item detail is a privileged read: it must not be fetched until asked for.
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes("/memory/items/"))).toBe(false);

    fireEvent.click(trigger);

    const dialog = await screen.findByRole("dialog", {
      name: /Weekend brunch service starts at 09:00/i,
    });
    await waitFor(() =>
      expect(
        fetchSpy.mock.calls.some(([url]) =>
          String(url).includes(`/memory/items/${verifiedItemId}`),
        ),
      ).toBe(true),
    );

    expect(within(dialog).getByText(/provenance/i)).toBeVisible();
    expect(await within(dialog).findByText(/operator_console/i)).toBeVisible();
    expect(within(dialog).getByText(/supersession chain/i)).toBeVisible();
    expect(
      await within(dialog).findByText(/Weekend brunch service starts at 10:00/i),
    ).toBeVisible();
    expect(within(dialog).getByText(/derived from/i)).toBeVisible();
    expect(within(dialog).getByText(/embedded/i)).toBeVisible();

    // `getItemDetail` returns the chain around the item without the item in it.
    // The inspected version must still be placed in the timeline, and a
    // predecessor must not be described as if it replaced this item.
    const chain = within(dialog).getByRole("list", { name: /supersession chain/i });
    const entries = within(chain).getAllByRole("listitem");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent("Weekend brunch service starts at 10:00");
    expect(entries[0]).toHaveTextContent(/earlier version/i);
    expect(entries[1]).toHaveTextContent("Weekend brunch service starts at 09:00");
    expect(entries[1]).toHaveTextContent(/the item you are inspecting/i);

    fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("labels trust rank, verification, freshness, and sensitivity in text", async () => {
    mockApi({ search: searchResponse({ results: [verifiedResult(), inferredResult()] }) });
    renderWorkspace();
    submitSearch();

    const verifiedGroup = await screen.findByRole("group", {
      name: /verified — first-party source/i,
    });
    const inferredGroup = screen.getByRole("group", { name: /unverified inference/i });

    expect(within(verifiedGroup).getByText("Verified")).toBeVisible();
    expect(within(verifiedGroup).getByText("Fresh")).toBeVisible();
    expect(within(verifiedGroup).getByText("Internal")).toBeVisible();
    expect(within(inferredGroup).getByText("Unverified")).toBeVisible();
    expect(within(inferredGroup).getByText("Review overdue")).toBeVisible();

    // Every status label carries an icon beside its text, so no state is
    // signalled by colour alone.
    for (const label of ["Verified", "Fresh", "Internal"]) {
      expect(
        within(verifiedGroup)
          .getByTestId(`memory-status-${label.toLowerCase()}`)
          .querySelector("svg"),
      ).not.toBeNull();
    }
  });

  it("distinguishes no memory, no match, and withheld content", async () => {
    mockApi({ search: searchResponse({ results: [] }) });
    const empty = renderWorkspace({
      snapshot: snapshot({ counts: { ...snapshot().counts, total: 0 } }),
    });

    expect(screen.getByText(/no business memory yet/i)).toBeVisible();
    empty.unmount();

    mockApi({ search: searchResponse({ results: [] }) });
    const noMatch = renderWorkspace();
    submitSearch();
    expect(await screen.findByText(/no memory matched/i)).toBeVisible();
    noMatch.unmount();

    mockApi({
      search: searchResponse({ results: [verifiedResult({ body: undefined })] }),
    });
    renderWorkspace();
    submitSearch();
    expect(await screen.findByText(/withheld at your access level/i)).toBeVisible();
  });

  it("keeps the previous results rendered during a background refresh", async () => {
    mockApi({});
    const { queryClient } = renderWorkspace();
    submitSearch();
    expect(await screen.findByText("Weekend brunch service starts at 09:00")).toBeVisible();

    // A refetch that never settles must add a status line, not blank the page.
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (() => new Promise(() => {})) as unknown as typeof fetch,
    );
    // Deliberately not awaited: the refetch never resolves, and the point of
    // the test is what stays rendered while it is in flight.
    void queryClient.invalidateQueries({ queryKey: memoryQueryKeys.root(organizationId) });

    expect(await screen.findByRole("status", { name: /refreshing memory/i })).toBeVisible();
    expect(screen.getByText("Weekend brunch service starts at 09:00")).toBeVisible();
    expect(screen.getByText("11")).toBeVisible();
  });

  it("renders the safe API message when a search is refused", async () => {
    mockApi({
      searchStatus: 403,
      searchError: {
        code: "MEMORY_SENSITIVITY_DENIED",
        message: "You cannot read memory at that sensitivity.",
      },
    });
    renderWorkspace();
    submitSearch();

    const failure = await screen.findByRole("alert", { name: /search could not be completed/i });
    expect(failure).toHaveTextContent(/You cannot read memory at that sensitivity\./);
    // No internal cause, stack, or retrieval log may reach the browser.
    expect(failure).not.toHaveTextContent(/MEMORY_SENSITIVITY_DENIED/);
  });

  it("moves focus to the aria-live result summary after a search", async () => {
    mockApi({});
    renderWorkspace();
    submitSearch();

    const summary = await screen.findByRole("status", { name: /search results/i });
    expect(summary).toHaveAttribute("aria-live", "polite");
    await waitFor(() => expect(summary).toHaveFocus());
    expect(summary).toHaveTextContent(/1 result/i);
  });

  it("sends only fields the search contract declares", async () => {
    const bodies: unknown[] = [];
    mockApi({ onSearch: (body) => bodies.push(body) });
    renderWorkspace();
    submitSearch();

    await waitFor(() => expect(bodies).toHaveLength(1));
    const body = bodies[0] as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ["includeExpired", "includeSuperseded", "limit", "query"].sort(),
    );
    // Search is idempotent; sending an idempotency key would imply a write.
    expect(body).not.toHaveProperty("idempotencyKey");
  });

  it("hides every mutation affordance from a viewer", async () => {
    mockApi({});
    renderWorkspace({ role: "viewer" });
    submitSearch();

    expect(await screen.findByRole("button", { name: /inspect chain/i })).toBeVisible();
    expect(screen.queryByRole("button", { name: /add note/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^verify$/i })).not.toBeInTheDocument();
    // "Superseded" is a read filter, so the mutation is matched exactly.
    expect(screen.queryByRole("button", { name: /^supersede$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reject proposal/i })).not.toBeInTheDocument();
    expect(screen.getByText(/read-only access/i)).toBeVisible();
  });

  it("scopes every query key to the exact organization", async () => {
    mockApi({});
    const { queryClient } = renderWorkspace();
    submitSearch();
    fireEvent.click(await screen.findByRole("button", { name: /inspect chain/i }));
    await screen.findByRole("dialog");

    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey);
    expect(keys.length).toBeGreaterThanOrEqual(3);
    for (const key of keys) {
      expect(key[0]).toBe("organizations");
      expect(key[1]).toBe(organizationId);
      expect(key[2]).toBe("memory");
      expect(JSON.stringify(key)).not.toContain(otherOrganizationId);
    }
    expect(keys).toContainEqual(memoryQueryKeys.snapshot(organizationId));
    expect(keys).toContainEqual(memoryQueryKeys.item(organizationId, verifiedItemId));
  });

  it("offers only filters the search contract can express", () => {
    mockApi({});
    renderWorkspace();

    // The installed ToggleGroup primitive exposes a roving-focus toolbar.
    expect(screen.getByRole("toolbar", { name: /memory type/i })).toBeVisible();
    expect(screen.getByRole("combobox", { name: /freshness/i })).toBeVisible();
    expect(screen.getByRole("combobox", { name: /sensitivity/i })).toBeVisible();
    // The Task 1 search contract is strict and carries neither filter.
    expect(screen.queryByRole("combobox", { name: /verification/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /source system/i })).not.toBeInTheDocument();
  });
});
