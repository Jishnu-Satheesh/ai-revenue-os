import { DomainError } from "@/lib/errors";
import {
  referenceResolutionSchema,
  type ReferenceResolution,
  type ResolvedReferenceSlot,
} from "@/domain/campaigns/reference-resolution";

const ROLE_ORDER: Record<ResolvedReferenceSlot["role"], number> = {
  subject: 0,
  brand_mark: 1,
  setting: 2,
  style_exemplar: 3,
  palette: 4,
  typography: 5,
};

const ROLE_INSTRUCTIONS: Record<ResolvedReferenceSlot["role"], string> = {
  subject:
    "This is the actual thing the campaign is about. Keep it identical: the same object, components and colours. Treatment may change only as the declared reference mode allows.",
  brand_mark: "Reproduce exactly. Never redraw, restyle, recolour or letter-space.",
  setting: "Use this place only for atmosphere, surfaces and light.",
  style_exemplar:
    "Take layout, spacing, colour relationships and mood. Take nothing literal: no object, text or mark.",
  palette: "Constrain colour only.",
  typography:
    "Constrain type feel only for the declared script. Do not render or copy any text from it.",
};

const FIXED_SYNTHESIS_CONSTRAINTS = [
  "No human faces.",
  "No hands unless the declared subject explicitly names them.",
  "No alcohol-coded element unless the declared subject declares it.",
  "Do not add any subject component absent from the declared subject.",
  "Do not render text of any kind, in any script.",
  "Photorealistic unless the declared subject explicitly declares an illustrated style.",
] as const;

export type ReferencePromptInput = {
  operatorCreativeDirection: string;
  subjectDescription: string | null;
  resolution: ReferenceResolution;
  hardConstraints: readonly string[];
};

/**
 * Builds the deterministic plate instruction around an already-resolved set.
 *
 * Human-authored text stays inside data blocks. The constraints come after
 * those blocks, so an operator cannot close a tag and displace a fixed fence.
 */
export function buildReferencePrompt(input: ReferencePromptInput): string {
  const resolution = referenceResolutionSchema.parse(input.resolution);
  const subjectReferences = resolution.referenceSlots.filter((slot) => slot.role === "subject");
  const description = input.subjectDescription?.trim() || null;

  if (
    resolution.outcome === "insufficient" ||
    (subjectReferences.length === 0 && description === null)
  ) {
    throw new DomainError(
      "VALIDATION_ERROR",
      "No declared subject is available for image generation.",
    );
  }

  const positiveReferences = [...resolution.referenceSlots]
    .sort(
      (left, right) =>
        ROLE_ORDER[left.role] - ROLE_ORDER[right.role] || left.ordinal - right.ordinal,
    )
    .map((reference) => {
      const modeInstruction =
        reference.referenceMode === "exact_match"
          ? "Match composition, framing, lighting and colour closely, while excluding all rendered text."
          : reference.role === "subject"
            ? "Preserve subject identity, but do not copy composition, framing or incidental text."
            : "Use only the eligible treatment signals; do not copy literal content.";
      const script = reference.script === null ? "" : ` script=${reference.script}`;
      return [
        `<reference role=${reference.role} ordinal=${reference.ordinal} mode=${reference.referenceMode}${script}>`,
        ROLE_INSTRUCTIONS[reference.role],
        modeInstruction,
        "</reference>",
      ].join("\n");
    });

  const avoidReferences = resolution.avoidReferences.map((reference, ordinal) =>
    [
      `<reference role=avoid ordinal=${ordinal} reasons=${reference.reasonCodes.join(",")}>`,
      "This was rejected, for the reasons attached. Do not produce anything resembling it. Never use it as a source of anything.",
      "</reference>",
    ].join("\n"),
  );

  const subjectData =
    description === null
      ? "The declared subject identity is supplied by the subject reference files."
      : escapeData(description);

  return [
    "Create one textless campaign plate from the declared subject and governed references below.",
    "",
    "<operator_creative_direction>",
    escapeData(input.operatorCreativeDirection),
    "</operator_creative_direction>",
    "",
    "<declared_subject>",
    subjectData,
    "</declared_subject>",
    "",
    "<positive_references>",
    positiveReferences.length === 0 ? "none" : positiveReferences.join("\n\n"),
    "</positive_references>",
    "",
    "<avoid_references>",
    avoidReferences.length === 0 ? "none" : avoidReferences.join("\n\n"),
    "</avoid_references>",
    "",
    "<fixed_synthesis_constraints>",
    ...FIXED_SYNTHESIS_CONSTRAINTS.map((constraint) => `- ${constraint}`),
    "</fixed_synthesis_constraints>",
    "",
    "<organization_hard_constraints>",
    ...(input.hardConstraints.length === 0
      ? ["none"]
      : input.hardConstraints.map((constraint) => `- ${escapeData(constraint)}`)),
    "</organization_hard_constraints>",
    "",
    "<negative_rules>",
    ...(resolution.negativeRules.length === 0
      ? ["none"]
      : resolution.negativeRules.map((rule) => `- ${rule.code}: ${escapeData(rule.description)}`)),
    "</negative_rules>",
  ].join("\n");
}

function escapeData(value: string): string {
  return value.replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
}
