// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OrganizationCompetitorsBlock } from "@/components/onboarding/organization-competitors-block";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";
const COMPETITOR = "80000000-0000-4000-8000-000000000008";

type SeenCall = { method: string; url: string; body?: unknown };

function stubCompetitorApi(rows: unknown[]) {
  const seen: SeenCall[] = [];
  const fetchMock = vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    let body: unknown;
    try {
      body = init?.body ? (JSON.parse(init.body) as unknown) : undefined;
    } catch {
      body = undefined;
    }
    seen.push({ method, url, body });
    const payload =
      method === "GET"
        ? { competitors: rows }
        : method === "DELETE"
          ? { deleted: true }
          : {
              competitor: {
                id: COMPETITOR,
                ...(typeof body === "object" && body !== null ? body : {}),
              },
            };
    return {
      ok: true,
      status: 200,
      json: async () => payload,
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return seen;
}

function savedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: COMPETITOR,
    organizationId: ORGANIZATION,
    name: "Rival Kitchen",
    website: "https://rival.example/menu",
    locationHint: "Deira",
    createdAt: "2026-09-22T00:00:00.000Z",
    updatedAt: "2026-09-22T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("OrganizationCompetitorsBlock", () => {
  it("reads the same organisation list the dialog seeds from", async () => {
    stubCompetitorApi([savedRow()]);

    render(<OrganizationCompetitorsBlock organizationId={ORGANIZATION} />);

    expect(await screen.findByText("Rival Kitchen")).toBeTruthy();
    expect(screen.getByText("Deira · https://rival.example/menu")).toBeTruthy();
    expect(screen.getByText(/starts from this same list/i)).toBeTruthy();
  });

  it("writes additions through the same store and validates names", async () => {
    const seen = stubCompetitorApi([]);

    render(<OrganizationCompetitorsBlock organizationId={ORGANIZATION} />);
    await screen.findByText("No competitors saved yet.");

    fireEvent.click(screen.getByRole("button", { name: /add a competitor/i }));
    expect(await screen.findByRole("alert")).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/competitor name/i), {
      target: { value: "Rival Kitchen" },
    });
    fireEvent.change(screen.getByLabelText(/website/i), {
      target: { value: "https://rival.example/menu" },
    });
    fireEvent.change(screen.getByLabelText(/location hint/i), {
      target: { value: "Deira" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add a competitor/i }));

    await waitFor(() =>
      expect(
        seen.some(
          (call) =>
            call.method === "POST" && call.url.includes("/growth-intelligence/competitors"),
        ),
      ).toBe(true),
    );
  });

  it("edits and removes through the same store by id", async () => {
    const seen = stubCompetitorApi([savedRow()]);

    render(<OrganizationCompetitorsBlock organizationId={ORGANIZATION} />);
    await screen.findByRole("button", { name: /remove competitor rival kitchen/i });

    fireEvent.click(screen.getByRole("button", { name: /edit competitor rival kitchen/i }));
    fireEvent.change(screen.getByLabelText(/location hint/i), { target: { value: "Marina" } });
    fireEvent.click(screen.getByRole("button", { name: /save competitor/i }));

    await waitFor(() =>
      expect(
        seen.some(
          (call) =>
            call.method === "PATCH" && call.url.includes(`/competitors/${COMPETITOR}`),
        ),
      ).toBe(true),
    );

    fireEvent.click(screen.getByRole("button", { name: /remove competitor rival kitchen/i }));
    await waitFor(() =>
      expect(
        seen.some(
          (call) =>
            call.method === "DELETE" && call.url.includes(`/competitors/${COMPETITOR}`),
        ),
      ).toBe(true),
    );
  });
});
