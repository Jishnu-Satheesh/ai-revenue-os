import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  consume: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ env: { COMING_SOON_ORIGINS: "https://lunes.in" } }));
vi.mock("@/lib/supabase/service", () => ({
  createPublicLeadsServiceClient: (...args: unknown[]) => mocks.createClient(...args),
}));
vi.mock("./rate-limit", () => ({
  consumeLeadAllowances: (...args: unknown[]) => mocks.consume(...args),
}));

import { OPTIONS, POST } from "@/app/api/public/leads/route";

const LEAD_ID = "aaaaaaaa-0000-4000-8000-000000000001";

function postRequest(body: unknown, origin: string | null = "https://lunes.in") {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (origin !== null) headers["Origin"] = origin;
  return new Request("http://localhost/api/public/leads", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockReturnValue({ rpc: mocks.rpc });
  mocks.consume.mockResolvedValue({ allowed: true });
  mocks.rpc.mockResolvedValue({
    data: { outcome: "recorded", lead_id: LEAD_ID },
    error: null,
  });
});

describe("OPTIONS preflight", () => {
  it("answers an allowed origin with an echoed allow-origin", async () => {
    const response = await OPTIONS(
      new Request("http://localhost/api/public/leads", {
        method: "OPTIONS",
        headers: { Origin: "https://lunes.in" },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://lunes.in");
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type");
    expect(response.headers.get("Vary")).toBe("Origin");
  });

  it("answers a disallowed origin without an echo, so the browser blocks it", async () => {
    const response = await OPTIONS(
      new Request("http://localhost/api/public/leads", {
        method: "OPTIONS",
        headers: { Origin: "https://evil.example" },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("POST signup", () => {
  it("records a valid early-access signup and normalizes the email", async () => {
    const response = await POST(postRequest({ email: "  Amina@Example.COM " }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, intent: "early-access" });
    expect(mocks.rpc).toHaveBeenCalledWith("record_public_lead", {
      input_lead: {
        email: "amina@example.com",
        intent: "early-access",
        name: null,
        source: "coming-soon",
      },
    });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://lunes.in");
  });

  it("treats a replayed signup as success without a second row", async () => {
    mocks.rpc.mockResolvedValue({
      data: { outcome: "replayed", lead_id: LEAD_ID },
      error: null,
    });

    const response = await POST(postRequest({ email: "amina@example.com" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, intent: "early-access" });
  });

  it("records a walkthrough request distinctly, with its name", async () => {
    const response = await POST(
      postRequest({ intent: "book-walkthrough", email: "amina@example.com", name: "Amina" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, intent: "book-walkthrough" });
    expect(mocks.rpc).toHaveBeenCalledWith("record_public_lead", {
      input_lead: {
        email: "amina@example.com",
        intent: "book-walkthrough",
        name: "Amina",
        source: "coming-soon",
      },
    });
  });

  it("rejects an invalid email before touching the limiter or the database", async () => {
    const response = await POST(postRequest({ email: "not-an-email" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "INVALID_EMAIL" });
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects an unknown intent", async () => {
    const response = await POST(postRequest({ intent: "buy-now", email: "amina@example.com" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "UNKNOWN_INTENT" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a body that is not JSON", async () => {
    const response = await POST(postRequest("{not-json"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "INVALID_REQUEST" });
  });

  it("refuses a disallowed origin", async () => {
    const response = await POST(
      postRequest({ email: "amina@example.com" }, "https://evil.example"),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "ORIGIN_NOT_ALLOWED" });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.headers.get("Vary")).toBe("Origin");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("processes a request with no origin, such as curl or a monitor", async () => {
    // A page in a browser cannot suppress its Origin header, so a missing one
    // means a non-browser caller — and this endpoint is public anyway.
    const response = await POST(postRequest({ email: "amina@example.com" }, null));

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalled();
  });

  it("answers an over-limit signup with a JSON 429, never an HTML error page", async () => {
    mocks.consume.mockResolvedValue({ allowed: false, reason: "limited" });

    const response = await POST(postRequest({ email: "amina@example.com" }));

    expect(response.status).toBe(429);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({ ok: false, error: "RATE_LIMITED" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("fails closed with a JSON 503 when the limiter is unavailable", async () => {
    mocks.consume.mockResolvedValue({ allowed: false, reason: "unavailable" });

    const response = await POST(postRequest({ email: "amina@example.com" }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "SERVICE_UNAVAILABLE" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("fails closed with a JSON 503 when the service key is missing", async () => {
    mocks.createClient.mockImplementation(() => {
      throw new Error("Public lead capture are not configured");
    });

    const response = await POST(postRequest({ email: "amina@example.com" }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "SERVICE_UNAVAILABLE" });
  });

  it("answers a database failure with a JSON 503 that leaks nothing", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "connection reset" } });

    const response = await POST(postRequest({ email: "amina@example.com" }));

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({ ok: false, error: "SERVICE_UNAVAILABLE" });
  });

  it("answers an unexpected record shape with a JSON 503", async () => {
    mocks.rpc.mockResolvedValue({ data: { outcome: "exploded" }, error: null });

    const response = await POST(postRequest({ email: "amina@example.com" }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "SERVICE_UNAVAILABLE" });
  });
});
