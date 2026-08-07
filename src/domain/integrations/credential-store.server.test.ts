import { describe, expect, it } from "vitest";

describe("credential-store server boundary", () => {
  it("cannot be imported through the client module condition", async () => {
    await expect(import("@/domain/integrations/credential-store.server")).rejects.toThrow(
      "cannot be imported from a Client Component",
    );
  });
});
