import { describe, expect, it } from "vitest";

import { metaOAuthApplicationSchema } from "@/lib/meta-oauth-application";

/**
 * Holding Meta application credentials is not the same as being able to use
 * Meta. These tests pin that distinction so a future change cannot quietly
 * turn "the secret is present" into "the provider is ready".
 */
describe("meta oauth application credentials", () => {
  it("is absent when neither value is configured", () => {
    expect(metaOAuthApplicationSchema.parse({})).toBeNull();
    expect(metaOAuthApplicationSchema.parse({ META_APP_ID: "", META_APP_SECRET: "" })).toBeNull();
  });

  it("is present only when both values are configured", () => {
    expect(
      metaOAuthApplicationSchema.parse({ META_APP_ID: "app-1", META_APP_SECRET: "shh" }),
    ).toEqual({ appId: "app-1", appSecret: "shh" });
  });

  it("rejects a half-configured application rather than guessing", () => {
    expect(() => metaOAuthApplicationSchema.parse({ META_APP_ID: "app-1" })).toThrow();
    expect(() => metaOAuthApplicationSchema.parse({ META_APP_SECRET: "shh" })).toThrow();
  });
});
