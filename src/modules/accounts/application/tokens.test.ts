import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createInvitationToken,
  digestsMatch,
  tokenDigest,
} from "@/modules/accounts/application/tokens";

describe("invitation tokens", () => {
  it("mints a 43-character base64url token, which is 32 bytes of entropy", () => {
    const { token } = createInvitationToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("never repeats", () => {
    const tokens = new Set(Array.from({ length: 500 }, () => createInvitationToken().token));
    expect(tokens.size).toBe(500);
  });

  it("returns a digest that is not the token", () => {
    const { token, tokenDigest: digest } = createInvitationToken();
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain(token);
    expect(token).not.toContain(digest);
  });

  it("derives the same digest for the same token, so a link can be looked up", () => {
    const { token, tokenDigest: digest } = createInvitationToken();
    expect(tokenDigest(token)).toBe(digest);
  });

  it("derives a different digest for a token differing in one character", () => {
    const digest = tokenDigest("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    const other = tokenDigest("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaab");
    expect(digest).not.toBe(other);
  });

  /**
   * The property the whole scheme rests on: a database containing every stored
   * value cannot yield a redeemable link.
   */
  it("cannot be reversed from what the database stores", () => {
    const { token, tokenDigest: digest } = createInvitationToken();
    expect(digest).not.toBe(token);
    expect(Buffer.from(digest, "hex").toString("base64url")).not.toBe(token);
  });

  describe("digestsMatch", () => {
    it("matches identical digests", () => {
      const { tokenDigest: digest } = createInvitationToken();
      expect(digestsMatch(digest, digest)).toBe(true);
    });

    it("refuses different digests, including ones of different length", () => {
      expect(digestsMatch(tokenDigest("a"), tokenDigest("b"))).toBe(false);
      expect(digestsMatch(tokenDigest("a"), "short")).toBe(false);
    });
  });
});
