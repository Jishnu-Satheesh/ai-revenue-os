import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const exchangeCodeForSession = vi.fn().mockResolvedValue({ data: {}, error: null });
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession } }),
}));

import { GET } from "@/app/auth/callback/route";

function callbackRequest(query: string) {
  return new Request(`https://app.example.com/auth/callback${query}`);
}

describe("the auth callback", () => {
  it("exchanges the code for a session", async () => {
    await GET(callbackRequest("?code=abc123"));
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc123");
  });

  it("sends a plain sign-in to the root, which resolves where the user belongs", async () => {
    const response = await GET(callbackRequest("?code=abc123"));
    expect(response.headers.get("location")).toBe("https://app.example.com/");
  });

  /**
   * The regression this route exists to prevent.
   *
   * An invitation's magic link used to point straight at the invitation page,
   * which never exchanges the code -- so the recipient arrived still signed out
   * and was asked to go back to their inbox a second time. Every magic link must
   * land here first, and carry where it was going.
   */
  it("returns the user to where the link was going, after signing them in", async () => {
    const response = await GET(callbackRequest("?code=abc123&next=%2Finvitations%2Fabc-token"));

    expect(exchangeCodeForSession).toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("https://app.example.com/invitations/abc-token");
  });

  /**
   * `next` comes from a link in an email, so it is attacker-influenced. Without
   * these refusals the callback would hand a freshly signed-in session to
   * whatever address someone put in the query string.
   */
  it.each([
    ["an absolute URL", "https://evil.example.com/steal"],
    ["a protocol-relative URL", "//evil.example.com/steal"],
    ["a backslash-escaped URL", "/\\evil.example.com/steal"],
    ["a scheme-only value", "javascript:alert(1)"],
  ])("refuses to forward the session to %s", async (_label, next) => {
    const response = await GET(callbackRequest(`?code=abc123&next=${encodeURIComponent(next)}`));

    expect(response.headers.get("location")).toBe("https://app.example.com/");
  });

  it("still lands somewhere sensible when there is no code at all", async () => {
    const response = await GET(callbackRequest(""));
    expect(response.headers.get("location")).toBe("https://app.example.com/");
  });
});
