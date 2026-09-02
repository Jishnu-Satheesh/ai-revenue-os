import type {
  CampaignGenerationProvider,
  CampaignGenerationResult,
  CampaignImageReference,
} from "@/ai/campaign-generation-provider";
import {
  artDirectionBlueprintSchema,
  type ArtDirectionBlueprint,
} from "@/domain/campaigns/art-direction";
import {
  referenceResolutionSchema,
  type ReferenceResolution,
} from "@/domain/campaigns/reference-resolution";
import { DomainError } from "@/lib/errors";

const BLUEPRINT_OUTPUT_CONTRACT = [
  "Return exactly one JSON object with these keys and no others:",
  "composition: non-empty string, maximum 800 characters",
  "framing: non-empty string, maximum 800 characters",
  "lighting: non-empty string, maximum 800 characters",
  "cameraTreatment: non-empty string, maximum 800 characters",
  "palette: 1 to 8 unique non-empty strings, maximum 300 characters each",
  "focalPoint: non-empty string, maximum 800 characters",
  "surfaceNotes: 0 to 8 unique non-empty strings, maximum 300 characters each",
  "propNotes: 0 to 12 unique non-empty strings, maximum 300 characters each",
  "avoid: 0 to 12 unique non-empty strings, maximum 300 characters each",
].join("\n");

export type BlueprintRepairPort = {
  repair(input: {
    body: string;
    outputContract: string;
    failures: readonly string[];
  }): Promise<CampaignGenerationResult>;
};

export type BlueprintPlannerInput = {
  context: {
    organizationId: string;
    campaignId: string;
    correlationId: string;
  };
  operatorCreativeDirection: string;
  brandContext: string;
  subjectDescription: string | null;
  resolution: ReferenceResolution;
  references: readonly CampaignImageReference[];
};

export type BlueprintPlanResult = {
  blueprint: ArtDirectionBlueprint;
  planModelId: string;
  repairModelId: string | null;
  costMinor: number | null;
};

export function createBlueprintPlanner(dependencies: {
  provider: Pick<CampaignGenerationProvider, "generatePlan">;
  repair: BlueprintRepairPort;
}) {
  return {
    async plan(input: BlueprintPlannerInput): Promise<BlueprintPlanResult> {
      const resolution = referenceResolutionSchema.parse(input.resolution);
      const hasSubjectReference = resolution.referenceSlots.some(
        (reference) => reference.role === "subject",
      );
      const hasSubjectDescription = (input.subjectDescription?.trim().length ?? 0) > 0;
      if (
        resolution.outcome === "insufficient" ||
        (!hasSubjectReference && !hasSubjectDescription)
      ) {
        throw new DomainError(
          "VALIDATION_ERROR",
          "No declared subject is available for art direction planning.",
        );
      }

      const planned = await dependencies.provider.generatePlan({
        context: input.context,
        system:
          "You plan visual treatment only. You cannot choose, rename or change the declared subject, and you cannot plan rendered text.",
        prompt: planningContext(input, resolution),
        outputContract: BLUEPRINT_OUTPUT_CONTRACT,
        references: input.references,
        planPurpose: "art_direction_blueprint",
      });

      const parsed = artDirectionBlueprintSchema.safeParse(planned.output);
      if (parsed.success) {
        return {
          blueprint: parsed.data,
          planModelId: planned.modelId,
          repairModelId: null,
          costMinor: planned.usage.estimatedCostMinor,
        };
      }

      const repaired = await dependencies.repair.repair({
        body: ["<invalid_blueprint>", safeModelJson(planned.output), "</invalid_blueprint>"].join(
          "\n",
        ),
        outputContract: BLUEPRINT_OUTPUT_CONTRACT,
        failures: parsed.error.issues.map((issue) => {
          const path = issue.path.length === 0 ? "root" : issue.path.join(".");
          return `${path}: ${issue.message}`;
        }),
      });
      const repairedBlueprint = artDirectionBlueprintSchema.safeParse(repaired.output);
      if (!repairedBlueprint.success) {
        throw new DomainError(
          "VALIDATION_ERROR",
          "Art direction blueprint did not satisfy the required contract.",
        );
      }

      return {
        blueprint: repairedBlueprint.data,
        planModelId: planned.modelId,
        repairModelId: repaired.modelId,
        costMinor: sumKnownCosts(
          planned.usage.estimatedCostMinor,
          repaired.usage.estimatedCostMinor,
        ),
      };
    },
  };
}

function planningContext(input: BlueprintPlannerInput, resolution: ReferenceResolution): string {
  const positiveReferences = resolution.referenceSlots.map(
    (reference) =>
      `- role=${reference.role} ordinal=${reference.ordinal} mode=${reference.referenceMode}${reference.script === null ? "" : ` script=${reference.script}`}`,
  );
  const avoidReferences = resolution.avoidReferences.map(
    (reference, ordinal) =>
      `- role=avoid ordinal=${ordinal} reasons=${reference.reasonCodes.join(",")}`,
  );

  return [
    "<operator_creative_direction>",
    escapeData(input.operatorCreativeDirection),
    "</operator_creative_direction>",
    "",
    "<brand_context>",
    escapeData(input.brandContext),
    "</brand_context>",
    "",
    "<declared_subject_context>",
    input.subjectDescription === null
      ? "Subject identity is supplied by the subject reference files."
      : escapeData(input.subjectDescription),
    "</declared_subject_context>",
    "",
    "<positive_references>",
    ...(positiveReferences.length === 0 ? ["none"] : positiveReferences),
    "</positive_references>",
    "",
    "<avoid_references>",
    ...(avoidReferences.length === 0 ? ["none"] : avoidReferences),
    "</avoid_references>",
    "",
    "<negative_rules>",
    ...(resolution.negativeRules.length === 0
      ? ["none"]
      : resolution.negativeRules.map((rule) => `- ${rule.code}: ${escapeData(rule.description)}`)),
    "</negative_rules>",
    "",
    "Plan treatment only. The declared subject and the textless plate constraints are injected after your object parses.",
  ].join("\n");
}

function safeModelJson(value: unknown): string {
  try {
    const serialized = JSON.stringify(value) ?? "null";
    return escapeData(serialized.slice(0, 20_000));
  } catch {
    return "null";
  }
}

function escapeData(value: string): string {
  return value.replaceAll("<", "\\u003c").replaceAll(">", "\\u003e");
}

function sumKnownCosts(...costs: Array<number | null>): number | null {
  if (costs.some((cost) => cost === null)) return null;
  return costs.reduce<number>((total, cost) => total + (cost ?? 0), 0);
}
