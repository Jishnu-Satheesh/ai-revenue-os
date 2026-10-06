import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { invitationSenderFrom } from "@/modules/accounts/application/invitation-email";

const FALLBACK = "Lunes AI <admin@lunes.in>";

describe("invitationSenderFrom", () => {
  it("derives the sender from the inviting account name", () => {
    expect(invitationSenderFrom("Al Noor Kitchen", FALLBACK)).toBe(
      "Al Noor Kitchen <alnoorkitchen@lunes.in>",
    );
  });

  it("lowercases and strips everything but ASCII letters and digits", () => {
    expect(invitationSenderFrom("Super-admin agency!", FALLBACK)).toBe(
      "Super-admin agency! <superadminagency@lunes.in>",
    );
  });

  it("falls back when the name has no usable letters", () => {
    expect(invitationSenderFrom("مطعم النور", FALLBACK)).toBe(FALLBACK);
    expect(invitationSenderFrom("", FALLBACK)).toBe(FALLBACK);
    expect(invitationSenderFrom("!!!", FALLBACK)).toBe(FALLBACK);
  });

  it("strips header-breaking characters from the display name", () => {
    const from = invitationSenderFrom('Evil\r\nBcc: spoofer, "x"', FALLBACK);
    expect(from).not.toMatch(/[\r\n<>"]/);
    expect(from).toContain("@lunes.in>");
  });

  it("caps the local part at 64 characters", () => {
    const from = invitationSenderFrom(`${"a".repeat(100)} Agency`, FALLBACK);
    const local = from.split("@")[0]?.split("<")[1] ?? "";
    expect(local).toHaveLength(64);
  });
});
