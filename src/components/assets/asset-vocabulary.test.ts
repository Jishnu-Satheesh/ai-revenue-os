import { describe, expect, it } from "vitest";

import {
  ASSET_OWNERSHIPS,
  CONDITIONING_ROLES,
  CREATIVE_REVIEW_REASON_CODES,
  CREATIVE_REVIEW_VERDICTS,
} from "@/domain/campaigns/asset-library";
import { ASSET_TRUTH_CLASSES } from "@/domain/campaigns/schemas";
import {
  conditioningRoleLabel,
  ownershipChoice,
  reviewReasonLabel,
  truthClassChip,
  verdictLabel,
} from "@/components/assets/asset-vocabulary";

/** A label that still reads like an identifier has not been translated. */
function readsAsCode(text: string): boolean {
  return /_/.test(text) || text === text.toLowerCase().replace(/ /g, "");
}

describe("every governed code has words a person can read", () => {
  it("labels every review reason, including the restaurant pack", () => {
    for (const code of CREATIVE_REVIEW_REASON_CODES) {
      const label = reviewReasonLabel(code);
      expect(label.length).toBeGreaterThan(2);
      expect(readsAsCode(label)).toBe(false);
    }
  });

  it("labels every conditioning role", () => {
    for (const role of CONDITIONING_ROLES) {
      expect(readsAsCode(conditioningRoleLabel(role))).toBe(false);
    }
  });

  it("labels every truth class and says what it means", () => {
    for (const truthClass of ASSET_TRUTH_CLASSES) {
      const chip = truthClassChip(truthClass);
      expect(readsAsCode(chip.label)).toBe(false);
      expect(chip.explanation.length).toBeGreaterThan(10);
    }
  });

  it("labels every verdict and ownership choice", () => {
    for (const verdict of CREATIVE_REVIEW_VERDICTS) {
      expect(readsAsCode(verdictLabel(verdict))).toBe(false);
    }
    for (const ownership of ASSET_OWNERSHIPS) {
      const choice = ownershipChoice(ownership);
      expect(readsAsCode(choice.label)).toBe(false);
      expect(choice.help.length).toBeGreaterThan(10);
    }
  });
});

describe("the ownership default is the safe answer", () => {
  it("marks third_party as the default and owned as the claim", () => {
    expect(ownershipChoice("third_party").isDefault).toBe(true);
    expect(ownershipChoice("owned").isDefault).toBe(false);
  });

  it("says plainly that owning it is what unlocks exact copying", () => {
    expect(ownershipChoice("owned").help).toMatch(/copy|copied|exact/i);
  });
});

describe("an unknown code never renders as a raw identifier", () => {
  it("falls back to sentence case rather than showing the code", () => {
    expect(reviewReasonLabel("some_future_code" as never)).toBe("Some future code");
  });
});
