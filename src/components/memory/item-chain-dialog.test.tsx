// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  Toaster: () => null,
}));

import { ItemChainDialog } from "@/components/memory/item-chain-dialog";
import type { MemoryRetrievalResult } from "@/domain/memory/schemas";
import type { OrganizationRole } from "@/domain/organizations/types";
import type { MemoryItemDetail, MemoryItemView } from "@/modules/memory/application/service";

const organizationId = "11111111-1111-4111-8111-111111111111";
const currentId = "22222222-2222-4222-8222-222222222222";
const historicalId = "33333333-3333-4333-8333-333333333333";

function itemView(overrides: Partial<MemoryItemView> = {}): MemoryItemView {
  return {
    id: currentId,
    memoryType: "note",
    title: "Opening hours are 09:00 to 22:00",
    body: "Confirmed with the general manager.",
    origin: "user_verified",
    sourceTier: 1,
    sourceSystem: "operator_console",
    verificationState: "verified",
    sensitivity: "internal",
    trustRank: 0,
    freshness: "fresh",
    embeddingStatus: "ready",
    verifiedAt: "2026-08-08T09:00:00.000Z",
    createdAt: "2026-08-07T09:00:00.000Z",
    ...overrides,
  };
}

const historicalView = itemView({
  id: historicalId,
  title: "Opening hours are 10:00 to 22:00",
  verificationState: "unverified",
  trustRank: 2,
  freshness: "superseded",
  supersededById: currentId,
  supersessionReason: "Opening time corrected after the service review.",
  embeddingStatus: "skipped",
  createdAt: "2026-07-01T09:00:00.000Z",
});

function searchResult(): MemoryRetrievalResult {
  return {
    itemId: currentId,
    memoryType: "note",
    title: "Opening hours are 09:00 to 22:00",
    body: "Confirmed with the general manager.",
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
    sensitivity: "internal",
    scores: { lexical: 0.8, semantic: 0.6, blended: 0.72 },
  };
}

function detailFor(itemId: string): MemoryItemDetail {
  if (itemId === historicalId) {
    return { item: historicalView, chain: [itemView()], links: [], currentFact: null };
  }
  return {
    item: itemView(),
    chain: [historicalView],
    links: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        relation: "derived_from",
        direction: "from",
        relatedItemId: historicalId,
      },
    ],
    currentFact: null,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

function mockApi() {
  return vi.spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
    const url = String(input);
    const itemId = url.split("/").pop()!;
    return jsonResponse(detailFor(itemId));
  }) as typeof fetch);
}

function renderDialog(options: { role?: OrganizationRole; useItem?: boolean } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {options.useItem ? (
        <ItemChainDialog
          organizationId={organizationId}
          item={itemView()}
          role={options.role}
          ceiling={options.role ? "confidential" : undefined}
        />
      ) : (
        <ItemChainDialog
          organizationId={organizationId}
          result={searchResult()}
          role={options.role}
          ceiling={options.role ? "confidential" : undefined}
        />
      )}
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => cleanup());

describe("Inspect chain dialog", () => {
  it("places the inspected item in its own supersession chain", async () => {
    mockApi();
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /inspect chain/i }));

    const dialog = await screen.findByRole("dialog");
    const chain = await within(dialog).findByRole("list", { name: /supersession chain/i });
    const entries = within(chain).getAllByRole("listitem");

    // The detail route returns the chain around the item, never the item; the
    // dialog must still show where the inspected version sits.
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent("Opening hours are 10:00 to 22:00");
    expect(entries[0]).toHaveTextContent(/earlier version/i);
    expect(entries[1]).toHaveTextContent("Opening hours are 09:00 to 22:00");
    expect(entries[1]).toHaveTextContent(/the item you are inspecting/i);
  });

  it("opens a historical version from the chain without losing the way back", async () => {
    mockApi();
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /inspect chain/i }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(
      await within(dialog).findByRole("button", { name: /inspect Opening hours are 10:00 to 22:00/i }),
    );

    // The superseded item stays reachable and is labelled as history, not hidden.
    expect(await within(dialog).findByText(/viewing a historical version/i)).toBeVisible();
    await waitFor(() =>
      expect(within(dialog).getByTestId("memory-status-superseded")).toBeVisible(),
    );
    expect(within(dialog).getByText(/Opening time corrected after the service review\./)).toBeVisible();

    fireEvent.click(within(dialog).getByRole("button", { name: /back to the current version/i }));
    await waitFor(() =>
      expect(within(dialog).queryByText(/viewing a historical version/i)).not.toBeInTheDocument(),
    );
  });

  it("shows provenance, references, evidence, sensitivity, and embedding state", async () => {
    mockApi();
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /inspect chain/i }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByText(/provenance/i)).toBeVisible();
    expect(await within(dialog).findByText(/operator_console/i)).toBeVisible();
    expect(within(dialog).getByText("review-2026-08")).toBeVisible();
    // Badges are matched by test id: "Verified" is also the label of the
    // verified-at row in the source reference grid.
    expect(within(dialog).getByTestId("memory-status-internal")).toBeVisible();
    expect(within(dialog).getByTestId("memory-status-verified")).toBeVisible();
    expect(within(dialog).getByTestId("memory-status-fresh")).toBeVisible();
    expect(await within(dialog).findByText("Embedded")).toBeVisible();
    expect(within(dialog).getByText(/derived from/i)).toBeVisible();
  });

  it("accepts a stored item as well as a search result", async () => {
    mockApi();
    renderDialog({ useItem: true });
    fireEvent.click(screen.getByRole("button", { name: /inspect chain/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Opening hours are 09:00 to 22:00")).toBeVisible();
    // A stored item carries no retrieval scores, so none may be implied.
    expect(within(dialog).queryByText(/relevance/i)).not.toBeInTheDocument();
  });

  it("restores focus to the trigger when Escape closes it", async () => {
    mockApi();
    renderDialog();
    const trigger = screen.getByRole("button", { name: /inspect chain/i });
    fireEvent.click(trigger);

    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("offers supersede only to a role that may supersede", async () => {
    mockApi();
    const viewer = renderDialog({ role: "viewer", useItem: true });
    fireEvent.click(screen.getByRole("button", { name: /inspect chain/i }));
    await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: /^supersede$/i })).not.toBeInTheDocument();
    viewer.unmount();

    mockApi();
    renderDialog({ role: "operator", useItem: true });
    fireEvent.click(screen.getByRole("button", { name: /inspect chain/i }));
    await screen.findByRole("dialog");
    expect(screen.getByRole("button", { name: /^supersede$/i })).toBeVisible();
  });
});
