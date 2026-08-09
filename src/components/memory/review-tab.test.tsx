// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const toastMocks = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMocks, Toaster: () => null }));

import { MemoryWorkspaceClient } from "@/components/memory/memory-workspace-client";
import type { OrganizationRole } from "@/domain/organizations/types";
import type { MemoryItemView, MemorySnapshot } from "@/modules/memory/application/service";

const organizationId = "11111111-1111-4111-8111-111111111111";
const proposalId = "22222222-2222-4222-8222-222222222222";
const lessonId = "33333333-3333-4333-8333-333333333333";
const evidenceId = "44444444-4444-4444-8444-444444444444";
const timelineIdOne = "55555555-5555-4555-8555-555555555555";
const timelineIdTwo = "66666666-6666-4666-8666-666666666666";
const serverTime = "2026-08-09T12:00:00.000Z";

function itemView(overrides: Partial<MemoryItemView> = {}): MemoryItemView {
  return {
    id: timelineIdOne,
    memoryType: "episode",
    title: "Supplier confirmed a delivery delay",
    body: "Called the supplier to confirm.",
    origin: "provider_imported",
    sourceTier: 2,
    sourceSystem: "google_business_profile",
    verificationState: "unverified",
    sensitivity: "internal",
    trustRank: 2,
    freshness: "fresh",
    observedAt: "2026-08-08T09:00:00.000Z",
    embeddingStatus: "ready",
    createdAt: "2026-08-08T09:00:00.000Z",
    ...overrides,
  };
}

function factProposal(overrides: Partial<MemoryItemView> = {}): MemoryItemView {
  return itemView({
    id: proposalId,
    memoryType: "fact_proposal",
    title: "Proposed update to google_business_profile.location.phone",
    body: undefined,
    verificationState: "proposed",
    trustRank: 4,
    proposedFactKey: "google_business_profile.location.phone",
    proposedFactValue: "+49 30 1234567",
    ...overrides,
  });
}

function snapshot(overrides: Partial<MemorySnapshot> = {}): MemorySnapshot {
  return {
    counts: {
      byType: { episode: 4 },
      byVerificationState: { proposed: 1 },
      bySensitivity: { internal: 5 },
      reviewQueueDepth: 1,
      embeddingBacklog: 0,
      total: 5,
    },
    recent: [],
    reviewQueue: [factProposal()],
    ceiling: "confidential",
    serverTime,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

type Routes = {
  timelinePages?: { items: MemoryItemView[]; nextCursor?: string }[];
  lessons?: { items: MemoryItemView[]; evidence: Record<string, string[]> };
  itemDetail?: (itemId: string) => unknown;
  confirm?: () => Promise<Response>;
  reject?: () => Promise<Response>;
  supersede?: () => Promise<Response>;
  createItem?: () => Promise<Response>;
  snapshot?: MemorySnapshot;
  onRequest?: (url: string, init?: RequestInit) => void;
};

function mockApi(routes: Routes = {}) {
  let timelineCall = 0;
  return vi.spyOn(globalThis, "fetch").mockImplementation((async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = String(input);
    routes.onRequest?.(url, init);
    if (url.includes("/memory/timeline")) {
      const pages = routes.timelinePages ?? [{ items: [itemView()] }];
      const page = pages[Math.min(timelineCall, pages.length - 1)];
      timelineCall += 1;
      return jsonResponse(page);
    }
    if (url.includes("/memory/lessons")) {
      return jsonResponse(routes.lessons ?? { items: [], evidence: {} });
    }
    if (url.includes("/confirm")) return routes.confirm?.() ?? jsonResponse({ itemId: proposalId, factId: null, promoted: false, memoryType: "fact_proposal", origin: "provider_imported", sensitivity: "internal", verificationState: "verified", replayed: false });
    if (url.includes("/reject")) return routes.reject?.() ?? jsonResponse({ itemId: proposalId, memoryType: "fact_proposal", origin: "provider_imported", sensitivity: "internal", verificationState: "rejected", replayed: false });
    if (url.includes("/supersede")) return routes.supersede?.() ?? jsonResponse({ replacementId: evidenceId, supersededId: timelineIdOne });
    if (/\/memory\/items\/[0-9a-f-]+$/.test(url)) {
      const itemId = url.split("/").pop()!;
      return jsonResponse(
        routes.itemDetail?.(itemId) ?? {
          // Only evidence reads get a distinct title; every other detail read
          // must echo the row's own title so the dialog shows what was opened.
          item: itemView({
            id: itemId,
            ...(itemId === evidenceId ? { title: `Evidence ${itemId.slice(0, 4)}` } : {}),
          }),
          chain: [],
          links: [],
        },
      );
    }
    if (url.endsWith("/memory/items")) return routes.createItem?.() ?? jsonResponse({ item: itemView() });
    if (url.endsWith("/memory/search")) {
      return jsonResponse({ results: [], retrievalMode: "hybrid", servedFromCache: false, serverTime });
    }
    return jsonResponse({ snapshot: routes.snapshot ?? snapshot() });
  }) as typeof fetch);
}

function renderWorkspace(options: { role?: OrganizationRole; snapshot?: MemorySnapshot } = {}) {
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

function openTab(name: RegExp) {
  // Radix activates a tab on mousedown, not on click.
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0 });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  vi.restoreAllMocks();
  toastMocks.success.mockReset();
  toastMocks.error.mockReset();
  toastMocks.info.mockReset();
});

afterEach(() => cleanup());

describe("Review tab governance", () => {
  it("keeps a fact proposal visible until confirmation resolves", async () => {
    const pending = deferred<Response>();
    mockApi({ confirm: () => pending.promise });
    renderWorkspace();
    openTab(/review/i);

    const proposal = await screen.findByText(/Proposed update to google_business_profile\.location\.phone/i);
    expect(proposal).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /confirm proposal/i }));

    // Non-optimistic: the row must not disappear while the request is in flight.
    expect(screen.getByText(/Proposed update to google_business_profile\.location\.phone/i)).toBeVisible();
    expect(toastMocks.success).not.toHaveBeenCalled();

    pending.resolve(
      jsonResponse({
        itemId: proposalId,
        factId: null,
        promoted: false,
        memoryType: "fact_proposal",
        origin: "provider_imported",
        sensitivity: "internal",
        verificationState: "verified",
        replayed: false,
      }),
    );
    await waitFor(() => expect(toastMocks.success).toHaveBeenCalled());
  });

  it("shows the proposed fact value and never invents the current one", async () => {
    mockApi({});
    renderWorkspace();
    openTab(/review/i);

    const row = await screen.findByRole("group", { name: /fact proposal/i });
    expect(within(row).getByText("google_business_profile.location.phone")).toBeVisible();
    expect(within(row).getByText(/\+49 30 1234567/)).toBeVisible();
    expect(within(row).getByText(/current value is not available/i)).toBeVisible();
  });

  it("requires a reason before it will post a rejection", async () => {
    const seen: string[] = [];
    mockApi({ onRequest: (url) => seen.push(url) });
    renderWorkspace();
    openTab(/review/i);

    fireEvent.click(await screen.findByRole("button", { name: /reject proposal/i }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: /^reject proposal$/i });

    fireEvent.click(confirm);
    expect(await within(dialog).findByText(/a rejection must say why/i)).toBeVisible();
    expect(seen.some((url) => url.includes("/reject"))).toBe(false);

    fireEvent.change(within(dialog).getByLabelText(/reason/i), {
      target: { value: "The provider number is a call centre, not the branch." },
    });
    fireEvent.click(confirm);
    await waitFor(() => expect(seen.some((url) => url.includes("/reject"))).toBe(true));
  });

  it("defaults overrideVerified to false and demands a second confirmation to override", async () => {
    const bodies: Record<string, unknown>[] = [];
    mockApi({
      onRequest: (url, init) => {
        if (url.includes("/confirm") && init?.body) bodies.push(JSON.parse(String(init.body)));
      },
    });
    renderWorkspace();
    openTab(/review/i);

    fireEvent.click(await screen.findByRole("button", { name: /confirm proposal/i }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ overrideVerified: false });
    expect(bodies[0]).toHaveProperty("idempotencyKey");

    // The override is a separate, deliberate act behind its own confirmation.
    fireEvent.click(screen.getByRole("button", { name: /override verification/i }));
    const override = await screen.findByRole("alertdialog");
    expect(within(override).getByText(/records a confirmation the source never made/i)).toBeVisible();
    fireEvent.click(within(override).getByRole("button", { name: /confirm without verification/i }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toMatchObject({ overrideVerified: true });
  });

  it("surfaces only the safe API message and keeps the row on failure", async () => {
    mockApi({
      confirm: async () =>
        jsonResponse(
          { error: { code: "MEMORY_PROPOSAL_INVALID", message: "This proposal can no longer be confirmed." } },
          400,
        ),
    });
    renderWorkspace();
    openTab(/review/i);

    fireEvent.click(await screen.findByRole("button", { name: /confirm proposal/i }));
    await waitFor(() => expect(toastMocks.error).toHaveBeenCalled());
    expect(toastMocks.error.mock.calls[0]?.[0]).toBe("This proposal can no longer be confirmed.");
    expect(toastMocks.error.mock.calls[0]?.[0]).not.toContain("MEMORY_PROPOSAL_INVALID");
    expect(screen.getByText(/Proposed update to google_business_profile\.location\.phone/i)).toBeVisible();
  });

  it("hides every governance control from a viewer", async () => {
    mockApi({});
    renderWorkspace({ role: "viewer" });
    openTab(/review/i);

    expect(await screen.findByText(/Proposed update to/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: /confirm proposal/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reject proposal/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /override verification/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add note/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^supersede$/i })).not.toBeInTheDocument();
  });
});

describe("Timeline tab", () => {
  it("appends only the returned cursor page and keeps earlier rows", async () => {
    const urls: string[] = [];
    mockApi({
      onRequest: (url) => urls.push(url),
      // A full page is what signals more history exists; a short page is the
      // end even though the read model still returns a cursor for it.
      timelinePages: [
        {
          items: [
            itemView(),
            ...Array.from({ length: 49 }, (_, index) =>
              itemView({
                id: `77777777-7777-4777-8777-${String(index).padStart(12, "0")}`,
                title: `Filler entry ${index}`,
              }),
            ),
          ],
          nextCursor:
            '{"observedAt":null,"createdAt":"2026-08-08T09:00:00.000Z","id":"' + timelineIdOne + '"}',
        },
        { items: [itemView({ id: timelineIdTwo, title: "Second page entry" })] },
      ],
    });
    renderWorkspace();
    openTab(/timeline/i);

    expect(await screen.findByText("Supplier confirmed a delivery delay")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /load older/i }));

    expect(await screen.findByText("Second page entry")).toBeVisible();
    // Appending must not drop the page already on screen.
    expect(screen.getByText("Supplier confirmed a delivery delay")).toBeVisible();
    const cursored = urls.filter((url) => url.includes("cursor="));
    expect(cursored).toHaveLength(1);
    expect(decodeURIComponent(cursored[0]!)).toContain(timelineIdOne);
  });

  it("filters by a source system actually present in the data", async () => {
    const urls: string[] = [];
    mockApi({
      onRequest: (url) => urls.push(url),
      timelinePages: [
        {
          items: [
            itemView(),
            itemView({ id: timelineIdTwo, title: "CSV import entry", sourceSystem: "csv_import" }),
          ],
        },
      ],
    });
    renderWorkspace();
    openTab(/timeline/i);

    await screen.findByText("Supplier confirmed a delivery delay");
    fireEvent.click(screen.getByRole("button", { name: /csv_import/i }));

    await waitFor(() =>
      expect(urls.some((url) => url.includes("sourceSystem=csv_import"))).toBe(true),
    );
  });
});

describe("Lessons tab", () => {
  it("expands derived_from evidence inline and reads it only on demand", async () => {
    const urls: string[] = [];
    mockApi({
      onRequest: (url) => urls.push(url),
      lessons: {
        items: [
          itemView({ id: lessonId, memoryType: "lesson", title: "Weekday lunch demand is understated" }),
        ],
        evidence: { [lessonId]: [evidenceId] },
      },
    });
    renderWorkspace();
    openTab(/lessons/i);

    expect(await screen.findByText("Weekday lunch demand is understated")).toBeVisible();
    expect(urls.some((url) => url.includes(`/memory/items/${evidenceId}`))).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /1 supporting item/i }));

    await waitFor(() =>
      expect(urls.some((url) => url.includes(`/memory/items/${evidenceId}`))).toBe(true),
    );
    expect(await screen.findByText(/Evidence 4444/i)).toBeVisible();
  });

  it("reports evidence it cannot read instead of hiding or inventing it", async () => {
    mockApi({
      lessons: {
        items: [itemView({ id: lessonId, memoryType: "lesson", title: "A lesson" })],
        evidence: { [lessonId]: [evidenceId] },
      },
      itemDetail: () => {
        throw new Error("unreachable");
      },
    });
    vi.spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/memory/lessons")) {
        return jsonResponse({
          items: [itemView({ id: lessonId, memoryType: "lesson", title: "A lesson" })],
          evidence: { [lessonId]: [evidenceId] },
        });
      }
      if (url.includes(`/memory/items/${evidenceId}`)) {
        return jsonResponse({ error: { code: "NOT_FOUND", message: "That memory item is unavailable." } }, 404);
      }
      if (url.includes("/memory/timeline")) return jsonResponse({ items: [] });
      return jsonResponse({ snapshot: snapshot() });
    }) as typeof fetch);

    renderWorkspace();
    openTab(/lessons/i);
    fireEvent.click(await screen.findByRole("button", { name: /1 supporting item/i }));

    expect(await screen.findByText(/evidence is no longer available to you/i)).toBeVisible();
  });
});

describe("Governed forms", () => {
  it("posts a note with a generated idempotency key after validation", async () => {
    const bodies: Record<string, unknown>[] = [];
    mockApi({
      onRequest: (url, init) => {
        if (url.endsWith("/memory/items") && init?.body) bodies.push(JSON.parse(String(init.body)));
      },
    });
    renderWorkspace();

    fireEvent.click(screen.getByRole("button", { name: /add note/i }));
    const dialog = await screen.findByRole("dialog", { name: /add to business memory/i });

    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));
    expect(await within(dialog).findByText(/give this memory a title/i)).toBeVisible();
    expect(bodies).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText(/^title$/i), {
      target: { value: "Kitchen closes at 22:00 on Sundays" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({
      memoryType: "note",
      title: "Kitchen closes at 22:00 on Sundays",
    });
    expect(String(bodies[0]!.idempotencyKey)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    await waitFor(() => expect(toastMocks.success).toHaveBeenCalled());
  });

  it("names the original, replacement, reason, and retained provenance before superseding", async () => {
    const bodies: Record<string, unknown>[] = [];
    mockApi({
      onRequest: (url, init) => {
        if (url.includes("/supersede") && init?.body) bodies.push(JSON.parse(String(init.body)));
      },
    });
    renderWorkspace();
    openTab(/timeline/i);

    // Supersede lives inside Inspect chain, so the provenance being replaced is
    // on screen when the correction is written.
    fireEvent.click(await screen.findByRole("button", { name: /inspect chain/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^supersede$/i }));
    const form = await screen.findByRole("dialog", { name: /supersede this memory/i });
    fireEvent.change(within(form).getByLabelText(/replacement title/i), {
      target: { value: "Supplier delivers on Tuesdays" },
    });
    fireEvent.change(within(form).getByLabelText(/reason/i), {
      target: { value: "Confirmed a new schedule with the supplier." },
    });
    fireEvent.click(within(form).getByRole("button", { name: /review and supersede/i }));

    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText(/Supplier confirmed a delivery delay/)).toBeVisible();
    expect(within(confirm).getByText(/Supplier delivers on Tuesdays/)).toBeVisible();
    expect(within(confirm).getByText(/Confirmed a new schedule with the supplier\./)).toBeVisible();
    expect(within(confirm).getByText(/provenance and audit history are retained/i)).toBeVisible();

    fireEvent.click(within(confirm).getByRole("button", { name: /^supersede memory$/i }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({
      title: "Supplier delivers on Tuesdays",
      reason: "Confirmed a new schedule with the supplier.",
      sensitivity: "internal",
    });
    expect(bodies[0]).toHaveProperty("idempotencyKey");
  });
});
