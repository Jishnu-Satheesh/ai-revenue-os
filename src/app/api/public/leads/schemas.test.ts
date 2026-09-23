import { describe, expect, it } from "vitest";

import { LeadApiError, parseLeadRequest } from "@/app/api/public/leads/schemas";

describe("parseLeadRequest", () => {
  it("accepts the shipped Coming Soon payload with no intent", () => {
    expect(parseLeadRequest({ email: "amina@example.com" })).toEqual({
      intent: "early-access",
      email: "amina@example.com",
      name: undefined,
      source: "coming-soon",
    });
  });

  it("trims and lowercases the email before anything stores it", () => {
    const parsed = parseLeadRequest({ email: "  Amina@Example.COM " });

    expect(parsed.email).toBe("amina@example.com");
  });

  it("accepts an explicit early-access intent", () => {
    const parsed = parseLeadRequest({ intent: "early-access", email: "amina@example.com" });

    expect(parsed.intent).toBe("early-access");
  });

  it("accepts a walkthrough request with a name", () => {
    expect(
      parseLeadRequest({ intent: "book-walkthrough", email: "amina@example.com", name: "Amina" }),
    ).toEqual({
      intent: "book-walkthrough",
      email: "amina@example.com",
      name: "Amina",
      source: "coming-soon",
    });
  });

  it("accepts a walkthrough request without a name", () => {
    const parsed = parseLeadRequest({ intent: "book-walkthrough", email: "amina@example.com" });

    expect(parsed.name).toBeUndefined();
  });

  it("trims the walkthrough name and drops a blank one", () => {
    expect(
      parseLeadRequest({
        intent: "book-walkthrough",
        email: "amina@example.com",
        name: "  Amina  ",
      }).name,
    ).toBe("Amina");
    expect(
      parseLeadRequest({ intent: "book-walkthrough", email: "amina@example.com", name: "   " })
        .name,
    ).toBeUndefined();
  });

  it("rejects an unknown intent without touching the email", () => {
    let error: unknown;
    try {
      parseLeadRequest({ intent: "buy-now", email: "amina@example.com" });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(LeadApiError);
    expect((error as LeadApiError).code).toBe("UNKNOWN_INTENT");
    expect((error as LeadApiError).status).toBe(400);
  });

  it("rejects a non-string intent as unknown rather than crashing", () => {
    expect(() => parseLeadRequest({ intent: 42, email: "amina@example.com" })).toThrowError(
      expect.objectContaining({ code: "UNKNOWN_INTENT" }),
    );
  });

  it.each([
    ["missing", {}],
    ["empty", { email: "" }],
    ["blank", { email: "   " }],
    ["non-string", { email: 42 }],
    ["no @ sign", { email: "not-an-email" }],
    ["no domain", { email: "amina@" }],
    ["too long", { email: `${"a".repeat(250)}@b.co` }],
  ])("rejects an %s email", (_label, body) => {
    let error: unknown;
    try {
      parseLeadRequest(body);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(LeadApiError);
    expect((error as LeadApiError).code).toBe("INVALID_EMAIL");
    expect((error as LeadApiError).status).toBe(400);
  });

  it("rejects a non-string walkthrough name", () => {
    expect(() =>
      parseLeadRequest({ intent: "book-walkthrough", email: "amina@example.com", name: 42 }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_NAME", status: 400 }));
  });

  it("rejects a walkthrough name longer than the column allows", () => {
    expect(() =>
      parseLeadRequest({
        intent: "book-walkthrough",
        email: "amina@example.com",
        name: "a".repeat(121),
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_NAME" }));
  });

  it("rejects a body that is not an object", () => {
    for (const body of [null, "amina@example.com", 42, ["amina@example.com"]]) {
      expect(() => parseLeadRequest(body)).toThrowError(
        expect.objectContaining({ code: "INVALID_REQUEST", status: 400 }),
      );
    }
  });

  it("ignores unknown keys so a client-side addition cannot brick signups", () => {
    // The Coming Soon form deploys independently of this repo. A strict
    // schema would turn their next harmless field into a 400 for every
    // visitor, and the client reports every non-2xx as a generic failure.
    const parsed = parseLeadRequest({ email: "amina@example.com", utm: "billboard" });

    expect(parsed.email).toBe("amina@example.com");
  });
});
