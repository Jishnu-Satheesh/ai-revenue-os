// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MarketWatchLivePreview } from "@/components/growth-intelligence/market-watch-live-preview";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";
const BRANCH_ID = "20000000-0000-4000-8000-000000000002";

function renderPreview(props: { canManage?: boolean; branchId?: string | null } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MarketWatchLivePreview
        organizationId={ORGANIZATION_ID}
        branchId={props.branchId === undefined ? BRANCH_ID : props.branchId}
        canManage={props.canManage ?? true}
      />
    </QueryClientProvider>,
  );
}

function successBody(results: Array<{ title: string; url: string; snippet: string }>) {
  const retrievedAt = "2026-09-15T10:00:00.000Z";
  return {
    results: results.map((item) => ({
      title: item.title,
      url: item.url,
      publisher: new URL(item.url).hostname,
      snippet: item.snippet,
      retrievedAt,
    })),
    queryCount: 1,
    resultCount: results.length,
    retrievedAt,
    correlationId: "90000000-0000-4000-8000-000000000009",
    liveOnly: true,
    disclaimer: "Live preview — not saved.",
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-4000-8000-000000000000" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MarketWatchLivePreview", () => {
  it("renders nothing for viewers without manage permission", () => {
    const { container } = renderPreview({ canManage: false });

    expect(container.innerHTML).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not fetch on mount or on dialog open before an explicit click", async () => {
    renderPreview();

    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /view live results/i }));

    expect(await screen.findAllByText(/shows fresh results, saves nothing/i)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches once from the live-preview route on explicit submit", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(successBody([])), { status: 200 }),
    );
    renderPreview();

    fireEvent.click(screen.getByRole("button", { name: /view live results/i }));
    fireEvent.change(screen.getByLabelText(/topics/i), {
      target: { value: "weekend brunch" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^show live results/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `/api/organizations/${ORGANIZATION_ID}/market-research/live-preview`,
    );
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ branchId: BRANCH_ID, topics: ["weekend brunch"] });
    expect(typeof body.idempotencyKey).toBe("string");
  });

  it("shows the empty state with discard copy", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(successBody([])), { status: 200 }),
    );
    renderPreview();

    fireEvent.click(screen.getByRole("button", { name: /view live results/i }));
    fireEvent.change(screen.getByLabelText(/topics/i), { target: { value: "brunch" } });
    fireEvent.click(screen.getByRole("button", { name: /^show live results/i }));

    expect(await screen.findByText(/no results for these terms/i)).toBeTruthy();
    expect(screen.getAllByText(/live preview — not saved/i).length).toBeGreaterThan(0);
  });

  it("shows an honest error without inventing results", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: "INTEGRATION_ERROR",
            message: "Live preview is temporarily unavailable. Try again.",
          },
        }),
        { status: 422 },
      ),
    );
    renderPreview();

    fireEvent.click(screen.getByRole("button", { name: /view live results/i }));
    fireEvent.change(screen.getByLabelText(/topics/i), { target: { value: "brunch" } });
    fireEvent.click(screen.getByRole("button", { name: /^show live results/i }));

    expect(await screen.findByText(/temporarily unavailable/i)).toBeTruthy();
    expect(screen.queryByText(/fresh lead/i)).toBeNull();
  });

  it("lists attributed results and never calls another persistence route", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          successBody([
            {
              title: "Brunch guide",
              url: "https://example.com/brunch-guide",
              snippet: "Fresh brunch spots",
            },
          ]),
        ),
        { status: 200 },
      ),
    );
    renderPreview();

    fireEvent.click(screen.getByRole("button", { name: /view live results/i }));
    fireEvent.change(screen.getByLabelText(/topics/i), { target: { value: "brunch" } });
    fireEvent.click(screen.getByRole("button", { name: /^show live results/i }));

    expect(await screen.findByText("Brunch guide")).toBeTruthy();
    expect(screen.getAllByText("example.com").length).toBeGreaterThan(0);
    expect(screen.getByText("Fresh brunch spots")).toBeTruthy();
    expect(screen.getAllByText(/unverified leads, not evidence/i).length).toBeGreaterThan(0);

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("/market-research/live-preview");
  });

  it("asks for a location when no branch is selected", () => {
    renderPreview({ branchId: null });

    fireEvent.click(screen.getByRole("button", { name: /view live results/i }));

    expect(screen.getByText(/choose a location first/i)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("closes and discards results so reopening starts idle", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify(
          successBody([
            {
              title: "Brunch guide",
              url: "https://example.com/brunch-guide",
              snippet: "Fresh brunch spots",
            },
          ]),
        ),
        { status: 200 },
      ),
    );
    renderPreview();

    fireEvent.click(screen.getByRole("button", { name: /view live results/i }));
    fireEvent.change(screen.getByLabelText(/topics/i), { target: { value: "brunch" } });
    fireEvent.click(screen.getByRole("button", { name: /^show live results/i }));
    expect(await screen.findByText("Brunch guide")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByText("Brunch guide")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: /view live results/i }));
    expect(await screen.findAllByText(/shows fresh results, saves nothing/i)).toBeTruthy();
    expect(screen.queryByText("Brunch guide")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
