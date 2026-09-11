import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { canonicalGroundedShareConsentText } from "@/domain/memory/grounded-share";
import { groundedShareWordingHash } from "@/modules/memory/application/grounded-share-hash";

describe("groundedShareWordingHash", () => {
  it("hashes the canonical wording with sha256", async () => {
    const { createHash } = await import("node:crypto");
    const expected = createHash("sha256")
      .update(canonicalGroundedShareConsentText(), "utf8")
      .digest("hex");
    const result = groundedShareWordingHash();
    expect(result.version).toBe("grounded-share-v1");
    expect(result.hash).toBe(expected);
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable across calls", () => {
    expect(groundedShareWordingHash().hash).toBe(groundedShareWordingHash().hash);
  });
});
