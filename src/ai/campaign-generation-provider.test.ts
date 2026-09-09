import { describe, expect, expectTypeOf, it } from "vitest";

import {
  finalImageReferenceSchema,
  type FinalImageReference,
} from "@/ai/campaign-generation-provider";

const reference = {
  ordinal: 0,
  mimeType: "image/png" as const,
  bytes: new Uint8Array([1]),
};

describe("final image evidence contract", () => {
  it("refuses rejected creative and legacy avoid evidence at the final-image boundary", () => {
    expect(
      finalImageReferenceSchema.safeParse({ ...reference, role: "rejected_creative" }).success,
    ).toBe(false);
    expect(finalImageReferenceSchema.safeParse({ ...reference, role: "avoid" }).success).toBe(
      false,
    );
  });

  it("accepts approved creative evidence at the final-image boundary", () => {
    const approved = finalImageReferenceSchema.parse({ ...reference, role: "approved_creative" });

    expect(approved.role).toBe("approved_creative");
    expectTypeOf<FinalImageReference>().toMatchTypeOf(approved);
  });
});
