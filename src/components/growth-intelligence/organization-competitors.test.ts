import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addOrganizationCompetitor,
  deleteOrganizationCompetitor,
  fetchOrganizationCompetitors,
  updateOrganizationCompetitor,
} from "@/components/growth-intelligence/organization-competitors";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";
const COMPETITOR = "80000000-0000-4000-8000-000000000008";
const COLLECTION = `/api/organizations/${ORGANIZATION}/growth-intelligence/competitors`;

type SeenCall = { method: string; url: string; body?: unknown };

function stubFetch(handler: (call: SeenCall) => unknown) {
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
    const call = { method, url, body };
    seen.push(call);
    const payload = handler(call);
    return {
      ok: true,
      status: 200,
      json: async () => payload,
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return seen;
}

function row(overrides: Record<string, unknown> = {}) {
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
  vi.unstubAllGlobals();
});

describe("organization competitors client", () => {
  it("reads the wrapped list response in returned order with nulls normalized", async () => {
    stubFetch(() => ({
      competitors: [
        row(),
        row({
          id: "81000000-0000-4000-8000-000000000081",
          name: "Neighbour Table",
          website: null,
          locationHint: null,
        }),
      ],
      correlationId: "30000000-0000-4000-8000-000000000003",
    }));

    const list = await fetchOrganizationCompetitors(ORGANIZATION);

    expect(list.map((entry) => entry.name)).toEqual(["Rival Kitchen", "Neighbour Table"]);
    expect(list[0]).toEqual({
      id: COMPETITOR,
      name: "Rival Kitchen",
      website: "https://rival.example/menu",
      locationHint: "Deira",
    });
    expect(list[1]).toMatchObject({ website: "", locationHint: "" });
  });

  it("throws on a failed list read with the status only", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503, json: async () => null })),
    );

    await expect(fetchOrganizationCompetitors(ORGANIZATION)).rejects.toThrow(
      "COMPETITOR_LIST_FAILED:503",
    );
  });

  it("adds through POST, omitting empty optionals the API would reject", async () => {
    const seen = stubFetch(() => ({ competitor: row(), correlationId: "c" }));

    const created = await addOrganizationCompetitor(ORGANIZATION, {
      name: "Rival Kitchen",
      website: "",
      locationHint: "",
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: "POST", url: COLLECTION });
    expect(seen[0]?.body).toEqual({ name: "Rival Kitchen" });
    expect(created).toMatchObject({ id: COMPETITOR, name: "Rival Kitchen" });
  });

  it("sends provided optionals on create", async () => {
    const seen = stubFetch(() => ({ competitor: row(), correlationId: "c" }));

    await addOrganizationCompetitor(ORGANIZATION, {
      name: "Rival Kitchen",
      website: "https://rival.example/menu",
      locationHint: "Deira",
    });

    expect(seen[0]?.body).toEqual({
      name: "Rival Kitchen",
      website: "https://rival.example/menu",
      locationHint: "Deira",
    });
  });

  it("updates through PATCH on the id-keyed item with null-clears", async () => {
    const seen = stubFetch(() => ({ competitor: row(), correlationId: "c" }));

    await updateOrganizationCompetitor(ORGANIZATION, COMPETITOR, {
      name: "Rival Kitchen",
      website: "",
      locationHint: "Marina",
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: "PATCH", url: `${COLLECTION}/${COMPETITOR}` });
    expect(seen[0]?.body).toEqual({
      name: "Rival Kitchen",
      website: null,
      locationHint: "Marina",
    });
  });

  it("deletes through DELETE on the id-keyed item", async () => {
    const seen = stubFetch(() => ({ deleted: true, correlationId: "c" }));

    await deleteOrganizationCompetitor(ORGANIZATION, COMPETITOR);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ method: "DELETE", url: `${COLLECTION}/${COMPETITOR}` });
  });
});
