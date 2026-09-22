// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ReportReviewDialog,
  type ReviewableAdviceItem,
} from "@/components/growth-intelligence/report-review-dialog";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";
const REPORT_VERSION = "63000000-0000-4000-8000-000000000063";
const ACCEPT_URL = `/api/organizations/${ORGANIZATION}/growth-intelligence/monitoring/reports/${REPORT_VERSION}/accept`;

const ITEMS: ReviewableAdviceItem[] = [
  {
    itemKey: "bundle",
    kind: "action",
    title: "Draft one clear family bundle",
    detail: "Name the occasion and what the customer receives.",
    destinationLabel: "Recommendations",
  },
  {
    itemKey: "late-note",
    kind: "finding",
    title: "Late-night demand is visible in reviews",
    detail: "Several reviews mention late closing times.",
    destinationLabel: "Insights",
  },
];

function dialogProps(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    onOpenChange: vi.fn(),
    organizationId: ORGANIZATION,
    reportVersionId: REPORT_VERSION,
    briefRevisionNumber: 1,
    reportTitle: "Prepare for National Day",
    reportDateLabel: "12 Sep 2026",
    items: [...ITEMS],
    canAccept: true,
    ...overrides,
  };
}

function acceptResponse(items: { itemKey: string; destination: string; outcome: string }[]) {
  return new Response(JSON.stringify({ items }), { status: 200 });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ReportReviewDialog", () => {
  it("lists each selected item with its detail and destination", () => {
    render(<ReportReviewDialog {...dialogProps()} />);

    const dialog = screen.getByRole("dialog", { name: /review selected items/i });
    expect(within(dialog).getByText("Report review")).toBeTruthy();
    expect(within(dialog).getByText(/Prepare for National Day · 12 Sep 2026/)).toBeTruthy();

    expect(within(dialog).getByText("Draft one clear family bundle")).toBeTruthy();
    expect(
      within(dialog).getByText("Name the occasion and what the customer receives."),
    ).toBeTruthy();
    expect(within(dialog).getByText("Adds to Recommendations")).toBeTruthy();
    expect(within(dialog).getByText("Late-night demand is visible in reviews")).toBeTruthy();
    expect(within(dialog).getByText("Adds to Insights")).toBeTruthy();

    expect(within(dialog).getByText(/2 items selected/)).toBeTruthy();
    expect(within(dialog).getByText(/1 to Recommendations/)).toBeTruthy();
    expect(within(dialog).getByText(/1 to Insights/)).toBeTruthy();
    expect(within(dialog).getByText(/keeps its link to this report \(Brief 1\)/)).toBeTruthy();
    expect(
      within(dialog).getByText(/Only these selected items will be added/),
    ).toBeTruthy();
    expect(
      within(dialog).getByText(/never approves campaign work, spending or publication/),
    ).toBeTruthy();
  });

  it("returns to the report without posting", () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("must not fetch");
    });
    vi.stubGlobal("fetch", fetchMock);
    const onOpenChange = vi.fn();
    render(<ReportReviewDialog {...dialogProps({ onOpenChange })} />);

    fireEvent.click(screen.getByRole("button", { name: /back to report/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the selection once with an idempotency key", async () => {
    const fetchMock = vi.fn(async () =>
      acceptResponse([
        { itemKey: "bundle", destination: "Recommendations", outcome: "accepted" },
        { itemKey: "late-note", destination: "Insights", outcome: "accepted" },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<ReportReviewDialog {...dialogProps()} />);

    fireEvent.click(screen.getByRole("button", { name: /accept selected items/i }));
    expect(await screen.findByText(/accepted to Recommendations/)).toBeTruthy();
    expect(screen.getByText(/accepted to Insights/)).toBeTruthy();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(ACCEPT_URL);
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body)) as {
      items: { itemKey: string; kind: string }[];
      idempotencyKey: string;
    };
    expect(body.items).toEqual([
      { itemKey: "bundle", kind: "action" },
      { itemKey: "late-note", kind: "finding" },
    ]);
    expect(body.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("single-flights rapid accept clicks into one request", async () => {
    const fetchMock = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return acceptResponse([
        { itemKey: "bundle", destination: "Recommendations", outcome: "accepted" },
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ReportReviewDialog {...dialogProps({ items: [ITEMS[0]] })} />);

    const accept = screen.getByRole("button", { name: /accept selected items/i });
    fireEvent.click(accept);
    fireEvent.click(accept);
    await screen.findByText(/accepted to Recommendations/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("explains an already-accepted replay and creates nothing", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? acceptResponse([{ itemKey: "bundle", destination: "Recommendations", outcome: "accepted" }])
        : acceptResponse([
            { itemKey: "bundle", destination: "Recommendations", outcome: "already_accepted" },
          ]);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ReportReviewDialog {...dialogProps({ items: [ITEMS[0]] })} />);

    fireEvent.click(screen.getByRole("button", { name: /accept selected items/i }));
    await screen.findByText(/accepted to Recommendations/);

    fireEvent.click(screen.getByRole("button", { name: /accept selected items/i }));
    await screen.findByText(/Already accepted — nothing new was added/);
    expect(screen.getByText(/already accepted; nothing new was added/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows a safe reason with retry when the route refuses the call", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? new Response("nope", { status: 403 })
        : acceptResponse([{ itemKey: "bundle", destination: "Recommendations", outcome: "accepted" }]);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<ReportReviewDialog {...dialogProps({ items: [ITEMS[0]] })} />);

    fireEvent.click(screen.getByRole("button", { name: /accept selected items/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/permission/);

    fireEvent.click(within(alert).getByRole("button", { name: /retry/i }));
    await screen.findByText(/accepted to Recommendations/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("hides accept controls with a reason when the reader cannot accept", () => {
    render(<ReportReviewDialog {...dialogProps({ canAccept: false })} />);

    expect(screen.queryByRole("button", { name: /accept selected items/i })).toBeNull();
    expect(screen.getByText(/needs the manage permission/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /back to report/i })).toBeTruthy();
  });

  it("explains an empty selection with accept held disabled", () => {
    render(<ReportReviewDialog {...dialogProps({ items: [] })} />);

    expect(screen.getByText(/No items are selected/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /accept selected items/i })).toBeDisabled();
  });

  it("resets its outcome state for the next open", async () => {
    const fetchMock = vi.fn(async () =>
      acceptResponse([{ itemKey: "bundle", destination: "Recommendations", outcome: "accepted" }]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <ReportReviewDialog {...dialogProps({ onOpenChange, items: [ITEMS[0]] })} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /accept selected items/i }));
    await screen.findByText(/accepted to Recommendations/);

    rerender(<ReportReviewDialog {...dialogProps({ onOpenChange, open: false, items: [ITEMS[0]] })} />);
    rerender(<ReportReviewDialog {...dialogProps({ onOpenChange, items: [ITEMS[0]] })} />);
    expect(screen.queryByText(/accepted to Recommendations/)).toBeNull();
    expect(screen.getByRole("button", { name: /accept selected items/i })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
