// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReportIntakeMapping } from "@/components/integrations/report-intake-mapping";

const ORGANIZATION = "11111111-1111-4111-8111-111111111111";
const PACKAGE = "22222222-2222-4222-8222-222222222222";

function renderMapping() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ReportIntakeMapping
        organizationId={ORGANIZATION}
        packageId={PACKAGE}
        onProposed={() => undefined}
      />
    </QueryClientProvider>,
  );
}

function respondWith(recognition: unknown) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!init || init.method !== "POST") {
      return new Response(JSON.stringify(recognition), { status: 200 });
    }
    return new Response(JSON.stringify({ reportContractVersion: { id: "v1" } }), { status: 201 });
  });
}

const RECOGNISED = {
  sheets: [],
  recognisedFamilies: [
    {
      key: "talabat.performance.daily",
      provider: "Talabat",
      reportType: "performance_daily",
      summary: "Daily sales and orders per outlet.",
      reads: ["revenue.gross", "transactions.count"],
      columns: ["date", "gross_sales", "successful_orders"],
    },
  ],
};

const UNRECOGNISED = {
  sheets: [
    {
      normalizedSheetName: "sales_report",
      sheetPosition: 1,
      rowCount: 40,
      headerRows: [
        { rowPosition: 1, columns: ["order_date", "total_sales", "total_orders", "pos_id"] },
      ],
    },
  ],
  recognisedFamilies: [],
};

let fetchMock: ReturnType<typeof respondWith>;

beforeEach(() => {
  vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: () => "fixed-idempotency-key" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("an upload the platform recognises", () => {
  beforeEach(() => {
    fetchMock = respondWith(RECOGNISED);
    vi.stubGlobal("fetch", fetchMock);
  });

  it("says what it is, and what it would record, in the operator's words", async () => {
    renderMapping();

    expect(await screen.findByText(/We recognise this report/i)).toBeInTheDocument();
    expect(screen.getByText(/Talabat/)).toBeInTheDocument();
    // Not "revenue.gross" and "transactions.count".
    expect(screen.getByText("sales and orders")).toBeInTheDocument();
  });

  it("sends only the family key, never a document", async () => {
    renderMapping();
    fireEvent.click(await screen.findByRole("button", { name: /use this mapping/i }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
      expect(post).toBeDefined();
      const body = JSON.parse(String(post?.[1]?.body));
      expect(body).toEqual({
        source: "library",
        providerDefinitionKey: "talabat.performance.daily",
        idempotencyKey: "report-contract-proposal:fixed-idempotency-key",
      });
      expect(body).not.toHaveProperty("mappingDocument");
    });
  });

  it("says plainly that nothing is read until someone approves", async () => {
    renderMapping();

    expect(
      await screen.findByText(/Nothing is read from the file until an owner or admin approves it/i),
    ).toBeInTheDocument();
  });
});

describe("an upload the platform does not recognise", () => {
  beforeEach(() => {
    fetchMock = respondWith(UNRECOGNISED);
    vi.stubGlobal("fetch", fetchMock);
  });

  it("asks about the operator's own columns rather than showing JSON", async () => {
    renderMapping();

    expect(await screen.findByText(/Tell us what these columns mean/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Which column is your sales\?/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/schemaVersion/)).not.toBeInTheDocument();
  });

  it("will not propose a mapping that records nothing", async () => {
    renderMapping();

    expect(await screen.findByRole("button", { name: /propose this mapping/i })).toBeDisabled();
  });

  it("sends the answers, and only the answers", async () => {
    renderMapping();

    fireEvent.click(await screen.findByLabelText(/Which column is your sales\?/i));
    fireEvent.click(await screen.findByRole("option", { name: "total sales" }));
    fireEvent.click(screen.getByRole("button", { name: /propose this mapping/i }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
      const body = JSON.parse(String(post?.[1]?.body));
      expect(body.source).toBe("guided");
      expect(body.guided).toMatchObject({
        normalizedSheetName: "sales_report",
        headerRow: 1,
        salesColumn: "total_sales",
      });
      expect(body.guided.ordersColumn).toBeUndefined();
    });
  });
});
