import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { validManifest } from "@/domain/campaigns/test-manifest";
import {
  applyOperatorEdit,
  type OperatorEdit,
} from "@/modules/campaigns/application/operator-edit";

function baseManifest() {
  return validManifest();
}

function editFor(overrides: Partial<OperatorEdit> = {}): OperatorEdit {
  const manifest = baseManifest();
  const direction = manifest.directions[0]!;
  const copy = direction.copy[0]!;
  return {
    directionId: direction.id,
    copyIndex: 0,
    hook: copy.hook,
    caption: copy.caption,
    callToAction: copy.callToAction,
    timingRationale: copy.timingRationale,
    hashtagSetIndex: null,
    tags: null,
    ...overrides,
  };
}

describe("an operator's own words are stored as written", () => {
  it("keeps the exact hook that was typed", () => {
    const result = applyOperatorEdit({
      base: baseManifest(),
      edit: editFor({ hook: "Lunch, sorted. Twelve to three." }),
      restrictedTerms: [],
    });

    if (result.outcome !== "accepted") throw new Error(`expected accepted: ${result.reason}`);
    expect(result.manifest.directions[0]?.copy[0]?.hook).toBe("Lunch, sorted. Twelve to three.");
  });

  it("produces a new digest, because the document genuinely changed", () => {
    const base = baseManifest();
    const result = applyOperatorEdit({
      base,
      edit: editFor({ caption: "A different caption entirely." }),
      restrictedTerms: [],
    });

    if (result.outcome !== "accepted") throw new Error("expected accepted");
    expect(result.diff.changes.length).toBeGreaterThan(0);
    expect(result.diff.invalidatesApproval).toBe(true);
  });

  it("refuses an edit that changes nothing rather than making an identical version", () => {
    const result = applyOperatorEdit({
      base: baseManifest(),
      edit: editFor(),
      restrictedTerms: [],
    });

    if (result.outcome !== "rejected") throw new Error("expected rejected");
    expect(result.reason).toBe("no_effect");
  });

  it("refuses a direction that is not part of this version", () => {
    const result = applyOperatorEdit({
      base: baseManifest(),
      edit: editFor({ directionId: "f0000000-0000-4000-8000-00000000ffff" }),
      restrictedTerms: [],
    });

    if (result.outcome !== "rejected") throw new Error("expected rejected");
    expect(result.reason).toBe("malformed_patch");
  });
});

describe("typing it by hand is not a way around the rules", () => {
  it("still applies restricted terms to copy a person wrote", () => {
    const result = applyOperatorEdit({
      base: baseManifest(),
      edit: editFor({ caption: "Guaranteed to cure what ails you." }),
      restrictedTerms: ["guaranteed"],
    });

    if (result.outcome !== "rejected") throw new Error("expected rejected");
    expect(result.reason).toBe("content_policy");
  });

  it("refuses newly added hashtags while no provider contract proves a limit", () => {
    // Generation produces empty tag sets today, precisely because no verified
    // contract states a limit. Adding tags by hand is a new violation, and is
    // refused exactly as a model proposing them would be.
    const manifest = baseManifest();
    for (const direction of manifest.directions) {
      for (const set of direction.hashtagSets) set.tags = [];
    }

    const result = applyOperatorEdit({
      base: manifest,
      edit: editFor({
        directionId: manifest.directions[0]!.id,
        hashtagSetIndex: 0,
        tags: ["#lunch", "#dubai"],
      }),
      restrictedTerms: [],
    });

    if (result.outcome !== "rejected") throw new Error("expected rejected");
    expect(result.reason).toBe("content_policy");
  });

  it("does not blame an operator for a violation that was already there", () => {
    // The fixture carries tags from before any contract was checked. Editing a
    // caption must not be refused because of them, or the person who could fix
    // the problem is the one person locked out of the screen.
    const result = applyOperatorEdit({
      base: baseManifest(),
      edit: editFor({ caption: "A perfectly ordinary new caption." }),
      restrictedTerms: [],
    });

    expect(result.outcome).toBe("accepted");
  });
});
