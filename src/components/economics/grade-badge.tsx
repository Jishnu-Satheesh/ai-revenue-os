import { StatusBadge } from "@/components/ui/status-badge";
import type { CompletenessGrade } from "@/domain/economics/types";

/**
 * How far a margin can be trusted, in one word.
 *
 * `specs/012` section 7 requires the grade visible on every row rather than
 * behind a tooltip, so this is deliberately a plain badge with a label and not
 * an icon-only affordance. Tone carries meaning but never carries it alone —
 * the word is always present, for colour-blind readers and for anyone scanning
 * a printed export.
 */
const tone = {
  complete: "success",
  partial: "warning",
  indicative: "neutral",
} as const satisfies Record<CompletenessGrade, "success" | "warning" | "neutral">;

const label: Readonly<Record<CompletenessGrade, string>> = {
  complete: "Complete",
  partial: "Partial",
  indicative: "Indicative",
};

export function GradeBadge({ grade }: { grade: CompletenessGrade }) {
  return <StatusBadge label={label[grade]} tone={tone[grade]} />;
}
