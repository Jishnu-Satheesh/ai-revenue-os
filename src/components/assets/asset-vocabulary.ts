import type {
  AssetOwnership,
  ConditioningRole,
  CreativeReviewReasonCode,
  CreativeReviewVerdict,
} from "@/domain/campaigns/asset-library";
import type { CampaignAssetTruthClass } from "@/domain/campaigns/schemas";

/**
 * The words the operator reads, kept apart from the words the database stores.
 *
 * Every governed vocabulary in this feature is an enum: reason codes, roles,
 * truth classes, verdicts, ownership. Those codes are stable identifiers and
 * are the right thing to store, log and audit. They are the wrong thing to show
 * a restaurant owner. `wrong_subject` tells them nothing; "This is not the dish"
 * tells them exactly what happened and what to do next.
 *
 * The fallback matters as much as the table. A code added to the domain and not
 * added here still renders as a readable sentence rather than leaking an
 * identifier into the interface, and the test holds every declared code to
 * having a real entry so the fallback stays a safety net rather than the norm.
 */

function sentenceCase(code: string): string {
  const words = code.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const REVIEW_REASON_LABELS: Readonly<Record<CreativeReviewReasonCode, string>> = {
  wrong_subject: "This is not the dish",
  wrong_style: "Wrong look for us",
  text_unreadable: "The writing is not legible",
  text_incorrect: "The writing is wrong",
  brand_mark_distorted: "Our logo is distorted",
  people_shown: "Shows people",
  prohibited_content: "Shows something we do not allow",
  low_quality: "Poor image quality",
  off_palette: "Wrong colours for us",
  not_localised: "Wrong language or script",
  other: "Something else",
  wrong_cuisine: "Wrong cuisine",
  alcohol_visible: "Alcohol is visible",
  unappetising: "Does not look appetising",
  not_our_plating: "Not how we plate it",
};

export function reviewReasonLabel(code: CreativeReviewReasonCode): string {
  return REVIEW_REASON_LABELS[code] ?? sentenceCase(code);
}

const CONDITIONING_ROLE_LABELS: Readonly<Record<ConditioningRole, string>> = {
  subject: "The thing itself",
  brand_mark: "Our logo",
  setting: "Where it sits",
  style_exemplar: "A look to follow",
  palette: "Colours",
  typography: "Lettering",
  avoid: "Do not do this",
};

export function conditioningRoleLabel(role: ConditioningRole): string {
  return CONDITIONING_ROLE_LABELS[role] ?? sentenceCase(role);
}

export type TruthClassChip = {
  label: string;
  explanation: string;
  /** `outline` throughout: none of these is a warning, and none is an award. */
  variant: "secondary" | "outline";
};

/**
 * Truth class describes where the pixels came from, and nothing else.
 *
 * It is deliberately not a quality grade. A drawn image is not worse than a
 * photograph, and saying so in the interface is how an operator learns to read
 * the chip as provenance rather than as a score.
 */
const TRUTH_CLASS_CHIPS: Readonly<Record<CampaignAssetTruthClass, TruthClassChip>> = {
  authentic_source: {
    label: "Your photograph",
    explanation: "Your own picture, used as it was supplied.",
    variant: "secondary",
  },
  synthetic_composite: {
    label: "Drawn from your photograph",
    explanation: "Drawn by the model, guided by a picture you supplied.",
    variant: "outline",
  },
  synthetic_generated: {
    label: "Drawn from your description",
    explanation: "Drawn by the model from the description you confirmed. No photograph was used.",
    variant: "outline",
  },
};

export function truthClassChip(truthClass: CampaignAssetTruthClass): TruthClassChip {
  return (
    TRUTH_CLASS_CHIPS[truthClass] ?? {
      label: sentenceCase(truthClass),
      explanation: "Where this image came from is not recorded.",
      variant: "outline",
    }
  );
}

const VERDICT_LABELS: Readonly<Record<CreativeReviewVerdict, string>> = {
  approved: "Approved",
  rejected: "Rejected",
};

export function verdictLabel(verdict: CreativeReviewVerdict): string {
  return VERDICT_LABELS[verdict] ?? sentenceCase(verdict);
}

export type OwnershipChoice = {
  label: string;
  help: string;
  /** `third_party` is the default because claiming ownership unlocks copying. */
  isDefault: boolean;
};

const OWNERSHIP_CHOICES: Readonly<Record<AssetOwnership, OwnershipChoice>> = {
  third_party: {
    label: "A reference we admire",
    help: "Someone else made this. We will take inspiration from it, never copy it.",
    isDefault: true,
  },
  owned: {
    label: "This is our own work",
    help: "We made this or we hold the rights. Only our own work may be copied exactly.",
    isDefault: false,
  },
};

export function ownershipChoice(ownership: AssetOwnership): OwnershipChoice {
  return (
    OWNERSHIP_CHOICES[ownership] ?? {
      label: sentenceCase(ownership),
      help: "Who made this is not recorded, so it is treated as someone else's work.",
      isDefault: true,
    }
  );
}
