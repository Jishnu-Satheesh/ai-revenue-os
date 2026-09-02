import type { ReferenceResolutionOutcome } from "@/domain/campaigns/asset-library";
import type { CampaignAssetTruthClass } from "@/domain/campaigns/schemas";

export type GeneratedAssetTruthClass = Exclude<CampaignAssetTruthClass, "authentic_source">;

export class TruthClassDerivationError extends Error {
  readonly name = "TruthClassDerivationError";
  readonly code = "no_declared_subject" as const;
}

/** A generated image's evidence path decides its label; a model never does. */
export function deriveGeneratedTruthClass(
  outcome: ReferenceResolutionOutcome,
): GeneratedAssetTruthClass {
  switch (outcome) {
    case "resolved":
      return "synthetic_composite";
    case "synthesis_permitted":
      return "synthetic_generated";
    case "insufficient":
      throw new TruthClassDerivationError(
        "An insufficient reference resolution cannot produce an asset truth class.",
      );
    default:
      return assertNever(outcome);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled reference resolution outcome: ${String(value)}`);
}
