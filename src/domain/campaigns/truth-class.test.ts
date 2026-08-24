import { describe, expect, it } from "vitest";

import {
  TruthClassDerivationError,
  deriveGeneratedTruthClass,
} from "@/domain/campaigns/truth-class";

describe("generated asset truth class", () => {
  it("labels a model drawing from the organization's subject photo as a composite", () => {
    expect(deriveGeneratedTruthClass("resolved")).toBe("synthetic_composite");
  });

  it("labels a model drawing from a confirmed description as generated", () => {
    expect(deriveGeneratedTruthClass("synthesis_permitted")).toBe("synthetic_generated");
  });

  it("refuses an insufficient outcome instead of inventing provenance", () => {
    expect(() => deriveGeneratedTruthClass("insufficient")).toThrow(TruthClassDerivationError);
    try {
      deriveGeneratedTruthClass("insufficient");
    } catch (error) {
      expect(error).toMatchObject({ code: "no_declared_subject" });
    }
  });
});
