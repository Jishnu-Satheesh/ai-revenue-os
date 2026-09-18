import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { formatWholeMoney } from "@/components/analysis/format";
import { Separator } from "@/components/ui/separator";
import styles from "@/components/organizations/home/organization-home.module.css";
import { formatAsOfDay } from "@/components/organizations/home/home-growth-chart";
import type { GrowthProgressView } from "@/modules/organizations/application/growth-progress-view";

/**
 * Advice rail for the Overview growth section (V06).
 *
 * Like the museum label's second half: it names the verdict first ("below"
 * or "above"), then offers at most two source-owned next steps. It never
 * invents a cause for the gap, never treats Planned as completed, and never
 * claims the platform earned anything from crossing the line. The rows and
 * their permission filtering come from the Task 5 advice service; this file
 * only renders them.
 */
export function HomeGrowthInsight({
  view,
  recommendationsHref,
}: Readonly<{ view: GrowthProgressView; recommendationsHref: string | null }>) {
  const currency = view.currency ?? "AED";
  const comparison = view.latestComparison;
  const differenceMinor = comparison?.differenceMinor ?? null;
  const differencePercent = comparison?.differencePercent ?? null;
  const state = comparison?.state ?? "unavailable";

  const statusTitle =
    state === "behind"
      ? "Below the projection"
      : state === "ahead"
        ? "Above the projection"
        : state === "within_range"
          ? "Within the projected range"
          : state === "equal"
            ? "In line with the projection"
            : "Comparison unavailable";

  // Within the range there is no alarming behind/ahead label just because the
  // actual differs from the midpoint; the money difference stays available in
  // the tooltip and method table (Task 7).
  const gapLine =
    (state === "behind" || state === "ahead") &&
    differenceMinor !== null &&
    differenceMinor !== 0 ? (
      <p className={styles.growthGapAmount}>
        {formatWholeMoney(Math.abs(differenceMinor), currency)}{" "}
        {state === "ahead" ? "ahead" : "behind"}
      </p>
    ) : state === "equal" ? (
      <p className={styles.growthGapAmount}>Current revenue matches this estimate.</p>
    ) : null;

  const percentLine =
    differenceMinor !== null &&
    differenceMinor !== 0 &&
    differencePercent !== null &&
    state !== "within_range" &&
    state !== "equal" ? (
      <p className={styles.growthGapPercent}>
        {Math.abs(differencePercent)}% {state === "ahead" ? "above" : "below"} the projected
        revenue
      </p>
    ) : state === "within_range" ? (
      <p className={styles.growthGapPercent}>Tracking within the estimate</p>
    ) : null;

  const adviceHeading =
    state === "ahead" ? "Build on this progress" : state === "behind" ? "What to look at" : null;

  return (
    <div className={styles.growthInsight}>
      <p className={styles.growthEyebrow}>
        {view.latestComparableDate !== null
          ? `AS OF ${formatAsOfDay(view.latestComparableDate)}`
          : "AS OF —"}
      </p>
      <h3 className={styles.growthStatusTitle}>{statusTitle}</h3>
      {gapLine}
      {percentLine}
      <Separator className={styles.growthInsightDivider} />
      {adviceHeading !== null ? (
        <h4 className={styles.growthAdviceHeading}>{adviceHeading}</h4>
      ) : null}
      {view.adviceRows.length > 0 ? (
        <ul className={styles.growthAdviceList}>
          {view.adviceRows.slice(0, 2).map((row) => (
            <li key={row.id} className={styles.growthAdviceRow}>
              {row.href ? (
                <Link
                  href={row.href}
                  className={styles.growthAdviceLink}
                  aria-label={`${row.title} — ${row.supportingText}`}
                >
                  <span className={styles.growthAdviceText}>
                    <span className={styles.growthAdviceTitle}>{row.title}</span>
                    <span className={styles.growthAdviceSupporting}>{row.supportingText}</span>
                  </span>
                  <ArrowRight aria-hidden="true" className={styles.growthAdviceArrow} />
                </Link>
              ) : (
                <span className={styles.growthAdviceText}>
                  <span className={styles.growthAdviceTitle}>{row.title}</span>
                  <span className={styles.growthAdviceSupporting}>{row.supportingText}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.growthAdviceEmpty}>
          We can see the difference, but do not yet have enough evidence to explain it.
        </p>
      )}
      {recommendationsHref !== null ? (
        <p className={styles.growthRecommendationsRow}>
          <Link href={recommendationsHref} className={styles.growthRecommendationsLink}>
            View recommendations <ArrowRight aria-hidden="true" />
          </Link>
        </p>
      ) : null}
    </div>
  );
}
