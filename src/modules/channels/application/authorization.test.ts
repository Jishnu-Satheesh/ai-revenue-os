import { describe, expect, it } from "vitest";

import { assertChannelPermission } from "@/modules/channels/application/authorization";

describe("channel authorization", () => {
  it("lets an operator map branches but not change channel identity", () => {
    expect(() => assertChannelPermission("operator", "channel.map_branch")).not.toThrow();
    expect(() => assertChannelPermission("operator", "channel.manage")).toThrow(
      "You do not have permission for this channel action.",
    );
  });

  it("lets viewers read but never mutate", () => {
    expect(() => assertChannelPermission("viewer", "channel.read")).not.toThrow();
    expect(() => assertChannelPermission("viewer", "channel.map_branch")).toThrow();
  });
});
