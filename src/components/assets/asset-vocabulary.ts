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

/**
 * Creative History's own vocabulary.
 *
 * These enums are distinct from the brand-asset ones above even where a word
 * looks similar — Creative History's rights are `owned | licensed |
 * permission_confirmed`, never the reference library's `owned | third_party`,
 * because a client's own past design carries a different question ("do we
 * have the right to use this again?") than a competitor's poster used as
 * inspiration ("did we make this?").
 */

const CREATIVE_TYPE_LABELS: Readonly<Record<string, string>> = {
  poster: "Poster",
  flyer: "Flyer",
  social_post: "Social post",
  story: "Story",
  carousel: "Carousel",
  banner: "Banner",
};

export function creativeTypeLabel(creativeType: string): string {
  return CREATIVE_TYPE_LABELS[creativeType] ?? sentenceCase(creativeType);
}

export type CreativeHistoryRightsChoice = {
  label: string;
  help: string;
};

const CREATIVE_HISTORY_RIGHTS_CHOICES: Readonly<Record<string, CreativeHistoryRightsChoice>> = {
  owned: {
    label: "We own this",
    help: "This design was made for us, or we hold the rights outright.",
  },
  licensed: {
    label: "We hold a licence",
    help: "We paid for the right to use this, under terms we still hold.",
  },
  permission_confirmed: {
    label: "We confirmed permission",
    help: "Whoever made this told us directly that we may keep using it.",
  },
};

export function creativeHistoryRightsChoice(status: string): CreativeHistoryRightsChoice {
  return (
    CREATIVE_HISTORY_RIGHTS_CHOICES[status] ?? {
      label: sentenceCase(status),
      help: "How we hold the rights to this design is not recorded.",
    }
  );
}

const CREATIVE_HISTORY_ELIGIBILITY_LABELS: Readonly<Record<string, string>> = {
  eligible_approved: "Approved for reuse",
  eligible_rejected: "Kept as what to avoid",
  archived: "Archived",
  metadata_unconfirmed: "Needs a confirmed description",
  unreviewed: "Not reviewed yet",
};

export function creativeHistoryEligibilityLabel(eligibility: string): string {
  return CREATIVE_HISTORY_ELIGIBILITY_LABELS[eligibility] ?? sentenceCase(eligibility);
}

const CREATIVE_HISTORY_UPLOAD_STATE_LABELS: Readonly<Record<string, string>> = {
  processing: "Processing",
  reserved: "Uploading",
  usable: "Uploaded",
  needs_review: "Needs review",
  refused: "Refused",
};

export function creativeHistoryUploadStateLabel(uploadState: string): string {
  return CREATIVE_HISTORY_UPLOAD_STATE_LABELS[uploadState] ?? sentenceCase(uploadState);
}

/**
 * A batch member's own reason for not becoming usable, in words rather than
 * the twelve-value discriminant `CreativeHistoryCompletionOutcome` carries.
 * Never collapses a permission or lookup failure into "the file never
 * arrived" — that exact mislabelling was a Task 2 review finding and stays
 * fixed here.
 */
const CREATIVE_HISTORY_REFUSAL_LABELS: Readonly<Record<string, string>> = {
  upload_missing: "No file arrived at the upload location. Try uploading it again.",
  empty_file: "That file is empty.",
  too_large: "That file is larger than this library allows.",
  unsupported_format: "Only JPEG, PNG, and WebP images are accepted.",
  declared_type_mismatch: "The file's contents do not match what it claimed to be.",
  corrupt_image: "The image could not be read. It may be incomplete or corrupted.",
  dimensions_out_of_range: "That image's dimensions are outside the allowed range.",
  storage_failed: "The checked image could not be stored. Try uploading it again.",
  item_unavailable: "That design is no longer available.",
  forbidden: "You no longer have permission to finish this upload.",
  invalid_request: "That upload's request was rejected.",
  unknown: "That upload could not be finished. Try uploading it again.",
  changed_bytes:
    "A different file is now at this upload slot. A finished version is never overwritten — start a new version instead.",
};

export function creativeHistoryRefusalLabel(reason: string, fallbackMessage?: string): string {
  return CREATIVE_HISTORY_REFUSAL_LABELS[reason] ?? fallbackMessage ?? sentenceCase(reason);
}
