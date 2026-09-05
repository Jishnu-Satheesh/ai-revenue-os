import { describe, expect, it } from "vitest";

import {
  evaluateCreativeVerification,
  plateDetectionReportSchema,
  type CreativeVerificationInput,
} from "@/modules/campaigns/application/creative-verification";

function input(overrides: Partial<CreativeVerificationInput> = {}): CreativeVerificationInput {
  return {
    glyphCoverage: { ran: true, value: { uncovered: [] } },
    plateText: { ran: true, value: { present: false } },
    faces: { ran: true, value: { identifiableCount: 0 } },
    subjectLikeness: { ran: true, value: { band: "strong" } },
    ...overrides,
  };
}

describe("evaluateCreativeVerification", () => {
  it("verifies creative when every blocking check ran and found nothing", () => {
    const result = evaluateCreativeVerification(input());

    expect(result.verified).toBe(true);
    expect(result.blocks).toEqual([]);
  });

  /**
   * The plate is the one thing a model drew. Text on it is text nobody approved
   * and the platform cannot correct, because it is baked into the image rather
   * than composited over it.
   */
  it("blocks a plate the model wrote text onto", () => {
    const result = evaluateCreativeVerification(
      input({ plateText: { ran: true, value: { present: true } } }),
    );

    expect(result.verified).toBe(false);
    expect(result.blocks.map((block) => block.code)).toContain("text_on_plate");
  });

  it("blocks an identifiable face, which nobody consented to appear", () => {
    const result = evaluateCreativeVerification(
      input({ faces: { ran: true, value: { identifiableCount: 2 } } }),
    );

    expect(result.verified).toBe(false);
    expect(result.blocks.map((block) => block.code)).toContain("identifiable_face");
  });

  it("blocks a codepoint no vendored font covers", () => {
    const result = evaluateCreativeVerification(
      input({ glyphCoverage: { ran: true, value: { uncovered: ["U+0D7B"] } } }),
    );

    expect(result.verified).toBe(false);
    expect(result.blocks.map((block) => block.code)).toContain("glyph_not_covered");
  });

  /**
   * Unknown is not a pass. A checker that could not run has not cleared the
   * creative, and treating its silence as approval is how an unchecked image
   * reaches a client's feed.
   */
  it("blocks when a blocking checker could not run, and names it", () => {
    const result = evaluateCreativeVerification(
      input({ faces: { ran: false, reason: "detector_timeout" } }),
    );

    expect(result.verified).toBe(false);
    const unavailable = result.blocks.find((block) => block.code === "verification_unavailable");
    expect(unavailable?.detail).toContain("faces");
  });

  /**
   * The advisory check is the one exception, and for a reason that is not
   * leniency: subject likeness could never have blocked, so its absence removes
   * nothing. Blocking on it would refuse creative that a working detector would
   * have passed.
   */
  it("does not block when only the advisory checker is unavailable", () => {
    const result = evaluateCreativeVerification(
      input({ subjectLikeness: { ran: false, reason: "detector_timeout" } }),
    );

    expect(result.verified).toBe(true);
    expect(result.advisories.map((advisory) => advisory.code)).toContain(
      "subject_likeness_unavailable",
    );
  });

  it("records weak likeness as advice and lets the creative through", () => {
    const result = evaluateCreativeVerification(
      input({ subjectLikeness: { ran: true, value: { band: "absent" } } }),
    );

    expect(result.verified).toBe(true);
    expect(result.advisories.map((advisory) => advisory.code)).toContain("subject_likeness_absent");
  });

  it("reports every reason it refused, not just the first", () => {
    const result = evaluateCreativeVerification(
      input({
        plateText: { ran: true, value: { present: true } },
        faces: { ran: true, value: { identifiableCount: 1 } },
        glyphCoverage: { ran: false, reason: "oracle_missing" },
      }),
    );

    expect(result.blocks.map((block) => block.code).sort()).toEqual([
      "identifiable_face",
      "text_on_plate",
      "verification_unavailable",
    ]);
  });

  /** What lands in `campaign_poster_renders.verification`, and it is auditable. */
  it("records what each checker found, including the ones that could not run", () => {
    const result = evaluateCreativeVerification(
      input({ faces: { ran: false, reason: "detector_timeout" } }),
    );

    expect(result.record).toMatchObject({
      verified: false,
      checks: {
        glyphCoverage: { ran: true },
        plateText: { ran: true },
        faces: { ran: false, reason: "detector_timeout" },
      },
    });
  });
});

describe("plateDetectionReportSchema", () => {
  /**
   * The model's output crosses a boundary here and is parsed, never trusted.
   * It reports observations; it does not get a vote on the verdict.
   */
  it("accepts a well-formed detection report", () => {
    const parsed = plateDetectionReportSchema.safeParse({
      textPresent: false,
      identifiableFaceCount: 0,
      subjectLikeness: "strong",
    });

    expect(parsed.success).toBe(true);
  });

  it("refuses a report that tries to declare its own verdict", () => {
    const parsed = plateDetectionReportSchema.safeParse({
      textPresent: false,
      identifiableFaceCount: 0,
      subjectLikeness: "strong",
      verified: true,
    });

    expect(parsed.success).toBe(false);
  });

  it("refuses a face count that is not a count", () => {
    expect(
      plateDetectionReportSchema.safeParse({
        textPresent: false,
        identifiableFaceCount: -1,
        subjectLikeness: "strong",
      }).success,
    ).toBe(false);
  });

  it("refuses a likeness band it was never given a vocabulary for", () => {
    expect(
      plateDetectionReportSchema.safeParse({
        textPresent: false,
        identifiableFaceCount: 0,
        subjectLikeness: "quite good actually",
      }).success,
    ).toBe(false);
  });
});
