// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReportAdmissionApproval } from "@/components/integrations/report-admission-approval";
import type { RecognisedFamily } from "@/components/integrations/report-intake-mapping";

const ORGANIZATION = "11111111-1111-4111-8111-111111111111";
const PACKAGE = "22222222-2222-4222-8222-222222222222";

const FAMILY: RecognisedFamily = {
  key: "talabat.performance.daily",
  provider: "Talabat",
  reportType: "performance_daily",
  summary: "Daily sales and orders per outlet.",
  reads: ["revenue.gross", "transactions.count"],
  columns: ["date", "gross_sales", "successful_orders"],
};

function renderApproval(
  overrides: Partial<{
    canApprove: boolean;
    onAdmitted: () => void;
  }> = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ReportAdmissionApproval
        organizationId={ORGANIZATION}
        packageId={PACKAGE}
        family={FAMILY}
        canApprove={overrides.canApprove ?? true}
        onAdmitted={overrides.onAdmitted ?? (() => undefined)}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: () => "fixed-key" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("an owner or admin viewing a recognised report", () => {
  it("names the report and lists what it will read, in the operator's words", () => {
    renderApproval();

    expect(screen.getByText(/Talabat/)).toBeInTheDocument();
    expect(screen.getByText(/performance daily/i)).toBeInTheDocument();
    // Not "revenue.gross" and "transactions.count".
    expect(screen.getByText(/This will read sales and orders/i)).toBeInTheDocument();
  });

  it("says plainly that approving is standing and revocable, not a one-file approval", () => {
    renderApproval();

    expect(screen.getByText(/does not approve just this file/i)).toBeInTheDocument();
    expect(screen.getByText(/every future upload of this report is read/i)).toBeInTheDocument();
    expect(screen.getByText(/until an owner or admin revokes it/i)).toBeInTheDocument();
  });

  it("renders a single Approve button", () => {
    renderApproval();

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName(/approve/i);
  });

  it("sends the library variant for both contract and projection, and no idempotency key", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ admission: { id: "admission-1" } }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderApproval();

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/organizations/${ORGANIZATION}/report-packages/${PACKAGE}/admission`);
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({
      contract: { source: "library", providerDefinitionKey: "talabat.performance.daily" },
      projection: { source: "library", providerDefinitionKey: "talabat.performance.daily" },
    });
  });

  it("disables the button while the request is in flight", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    renderApproval();

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() => expect(screen.getByRole("button")).toBeDisabled());
  });

  it("tells onAdmitted once the standing admission is granted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ admission: { id: "admission-1" } }), { status: 200 }),
      ),
    );
    const onAdmitted = vi.fn();
    renderApproval({ onAdmitted });

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() => expect(onAdmitted).toHaveBeenCalledTimes(1));
  });

  it("surfaces the server's own explanation when the grant is refused", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: "VALIDATION_ERROR",
                message: "This upload has not been profiled yet.",
              },
            }),
            { status: 409 },
          ),
      ),
    );
    renderApproval();

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /approve/i })).not.toBeDisabled(),
    );
  });
});

describe("an operator without report.contract_approve", () => {
  it("explains what happens next instead of showing a dead end", () => {
    renderApproval({ canApprove: false });

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(/an owner or admin needs to approve it once/i)).toBeInTheDocument();
    expect(screen.getByText(/goes straight through/i)).toBeInTheDocument();
    expect(screen.queryByText(/permission denied/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/you do not have permission/i)).not.toBeInTheDocument();
  });

  it("still names the report and what it reads, even without the button", () => {
    renderApproval({ canApprove: false });

    expect(screen.getByText(/Talabat/)).toBeInTheDocument();
    expect(screen.getByText(/This will read sales and orders/i)).toBeInTheDocument();
  });
});
