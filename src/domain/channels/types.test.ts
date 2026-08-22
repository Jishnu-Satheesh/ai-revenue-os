import { describe, expect, it } from "vitest";

import {
  channelAliasInputSchema,
  channelBranchMappingInputSchema,
  channelCreateInputSchema,
  channelUpdateInputSchema,
} from "@/domain/channels/types";

describe("channel management contracts", () => {
  it("accepts a custom channel without treating a template as executable access", () => {
    expect(
      channelCreateInputSchema.parse({
        key: "smile.easy-eats",
        displayName: "Smile (Easy Eats)",
        category: "marketplace",
        templateKey: "smile",
      }),
    ).toMatchObject({
      key: "smile.easy-eats",
      displayName: "Smile (Easy Eats)",
      category: "marketplace",
      templateKey: "smile",
    });
  });

  it("rejects a display label as a stable channel key", () => {
    expect(() =>
      channelCreateInputSchema.parse({
        key: "Smile (Easy Eats)",
        displayName: "Smile (Easy Eats)",
        category: "marketplace",
      }),
    ).toThrow();
  });

  it("only permits governed mutable channel fields", () => {
    expect(
      channelUpdateInputSchema.parse({
        displayName: "Nostaza Direct",
        category: "owned_digital",
        templateKey: null,
        status: "archived",
      }),
    ).toEqual({
      displayName: "Nostaza Direct",
      category: "owned_digital",
      templateKey: null,
      status: "archived",
    });
    expect(() => channelUpdateInputSchema.parse({ key: "renamed-key" })).toThrow();
  });

  it("validates branch mappings and source aliases separately", () => {
    expect(
      channelBranchMappingInputSchema.parse({
        branchId: "11111111-1111-4111-8111-111111111111",
        applicability: "active",
      }),
    ).toMatchObject({ applicability: "active" });
    expect(
      channelAliasInputSchema.parse({
        alias: "Smile (Easy Eats)",
        sourceScope: "manual",
      }),
    ).toEqual({ alias: "Smile (Easy Eats)", sourceScope: "manual" });
    expect(() => channelAliasInputSchema.parse({ alias: "", sourceScope: "manual" })).toThrow();
  });
});
