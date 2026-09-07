import { z } from "zod";

/**
 * Whether a poster may be used, decided by code.
 *
 * A model may look at a plate and report what it sees -- text, faces, whether
 * the dish resembles the one that was described. It reports observations and
 * nothing else. The verdict is computed here, deterministically, from those
 * observations, because "is this creative allowed out" is a policy question and
 * a model asked to answer it will sometimes say yes for reasons nobody can
 * reconstruct afterwards.
 *
 * The rule that does the most work: **unknown is not a pass.** A checker that
 * could not run has not cleared anything, and reading its silence as approval is
 * exactly how an unchecked image reaches a client's feed. So an unavailable
 * blocking checker blocks.
 *
 * The single exception is the advisory checker, and it is not leniency. Subject
 * likeness could never have blocked; its absence therefore removes nothing that
 * would have stopped the poster, and blocking on it would refuse creative that a
 * working detector would have passed.
 */

export const PLATE_LIKENESS_BANDS = ["strong", "weak", "absent"] as const;

/**
 * The model's output, at the boundary where it stops being trusted.
 *
 * Strict on purpose. A report carrying its own `verified` field is refused
 * rather than ignored: a model that has learned to volunteer a verdict is a
 * model whose prompt has drifted, and that is worth failing loudly over.
 */
export const plateDetectionReportSchema = z.strictObject({
  /** Any legible text drawn onto the plate. The plate is meant to carry none. */
  textPresent: z.boolean(),
  /** Faces a person could recognise. Crowds and silhouettes are not these. */
  identifiableFaceCount: z.number().int().nonnegative().max(100),
  /** How well the plate resembles the declared subject. Advice only. */
  subjectLikeness: z.enum(PLATE_LIKENESS_BANDS),
});

export type PlateDetectionReport = z.infer<typeof plateDetectionReportSchema>;

export type CheckResult<T> =
  | { readonly ran: true; readonly value: T }
  | { readonly ran: false; readonly reason: string };

export type CreativeVerificationInput = {
  /** Deterministic, and computed from the fonts rather than observed. */
  readonly glyphCoverage: CheckResult<{ uncovered: readonly string[] }>;
  readonly plateText: CheckResult<{ present: boolean }>;
  readonly faces: CheckResult<{ identifiableCount: number }>;
  /** Advisory. Never blocks, and never blocks by being absent either. */
  readonly subjectLikeness: CheckResult<{ band: (typeof PLATE_LIKENESS_BANDS)[number] }>;
};

export type VerificationBlockCode =
  | "glyph_not_covered"
  | "text_on_plate"
  | "identifiable_face"
  | "verification_unavailable";

export type VerificationNote = {
  readonly code: string;
  readonly detail: string;
};

export type CreativeVerification = {
  readonly verified: boolean;
  readonly blocks: readonly (VerificationNote & { code: VerificationBlockCode })[];
  readonly advisories: readonly VerificationNote[];
  /** Exactly what is stored in `campaign_poster_renders.verification`. */
  readonly record: Readonly<Record<string, unknown>>;
};

export function evaluateCreativeVerification(
  input: CreativeVerificationInput,
): CreativeVerification {
  const blocks: (VerificationNote & { code: VerificationBlockCode })[] = [];
  const advisories: VerificationNote[] = [];
  const unavailable: string[] = [];

  if (!input.glyphCoverage.ran) {
    unavailable.push("glyphCoverage");
  } else if (input.glyphCoverage.value.uncovered.length > 0) {
    blocks.push({
      code: "glyph_not_covered",
      detail: `No vendored font covers ${input.glyphCoverage.value.uncovered.join(", ")}.`,
    });
  }

  if (!input.plateText.ran) {
    unavailable.push("plateText");
  } else if (input.plateText.value.present) {
    blocks.push({
      code: "text_on_plate",
      // Worth stating plainly: this is unfixable rather than merely wrong. The
      // words are pixels in the generated image, not a layer over it.
      detail:
        "The plate carries text the model drew, which no approval covers and the compositor cannot remove.",
    });
  }

  if (!input.faces.ran) {
    unavailable.push("faces");
  } else if (input.faces.value.identifiableCount > 0) {
    blocks.push({
      code: "identifiable_face",
      detail: `The plate shows ${input.faces.value.identifiableCount} identifiable face(s), and nobody consented to appear.`,
    });
  }

  if (unavailable.length > 0) {
    blocks.push({
      code: "verification_unavailable",
      detail: `These checks could not run and so cleared nothing: ${unavailable.join(", ")}.`,
    });
  }

  if (!input.subjectLikeness.ran) {
    advisories.push({
      code: "subject_likeness_unavailable",
      detail: `Subject likeness could not be assessed: ${input.subjectLikeness.reason}.`,
    });
  } else if (input.subjectLikeness.value.band !== "strong") {
    advisories.push({
      code: `subject_likeness_${input.subjectLikeness.value.band}`,
      detail:
        "The plate may not resemble the dish that was described. Worth a look before it publishes.",
    });
  }

  const verified = blocks.length === 0;

  return {
    verified,
    blocks,
    advisories,
    record: {
      verified,
      blocks: blocks.map((block) => ({ code: block.code, detail: block.detail })),
      advisories: advisories.map((advisory) => ({
        code: advisory.code,
        detail: advisory.detail,
      })),
      checks: {
        glyphCoverage: describe(input.glyphCoverage),
        plateText: describe(input.plateText),
        faces: describe(input.faces),
        subjectLikeness: describe(input.subjectLikeness),
      },
    },
  };
}

/**
 * A checker's own account of itself, stored whether or not it ran.
 *
 * Recording the failures matters as much as recording the findings: a render
 * refused three weeks ago needs to be explainable without the detector that
 * refused it still being around to ask.
 */
function describe<T>(result: CheckResult<T>): Readonly<Record<string, unknown>> {
  return result.ran ? { ran: true, ...result.value } : { ran: false, reason: result.reason };
}
