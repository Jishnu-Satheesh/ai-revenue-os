/**
 * Curated channel playbooks for the recommendations pilot.
 *
 * Deterministic and local: no I/O, no clock, no network, no model. The worker
 * selects guidance by channel identity and detector key, then hands it to the
 * narrator as fenced data. The narrator still decides what fits the cited
 * finding; a playbook step that does not fit is left out rather than forced.
 *
 * Pilot scope is deliberate: cancellations
 * (`orders.cancellation_loss`, `orders.cancellation_attribution`) and
 * availability (`operations.closed_share`) only. Every other detector gets no
 * playbook, which reads as the pre-pilot generic prompt.
 *
 * Steps are framed as checks in the operator's own portal or on their own
 * tablet, never as claims about a portal's exact menu structure. A step that
 * named a menu path nobody verified would be a hallucinated manual; a step
 * that says "compare the hours in the merchant portal you use with the tablet
 * status" stays Talabat-specific without inventing what the portal contains.
 */

/** Bumped only when a playbook's steps change. */
export const CHANNEL_PLAYBOOK_VERSION = 1;

/** The pilot detectors a playbook may accompany. */
export const PILOT_PLAYBOOK_DETECTOR_KEYS: ReadonlySet<string> = new Set([
  "orders.cancellation_loss",
  "orders.cancellation_attribution",
  "operations.closed_share",
]);

export type PlaybookGuidanceItem = {
  detectorKey: string;
  title: string;
  steps: readonly string[];
  /** Where the steps come from, in the operator's terms. Never a URL. */
  sourceLabel: string;
};

function isTalabatChannel(input: { channelKey: string; templateKey: string | null }): boolean {
  const key = input.channelKey.toLowerCase();
  const template = (input.templateKey ?? "").toLowerCase();
  return key.includes("talabat") || template.includes("talabat");
}

function hasClosedReason(reasonLabels: readonly string[]): boolean {
  return reasonLabels.some((label) => label.trim().toUpperCase() === "CLOSED");
}

function talabatCancellationClosedSteps(): readonly string[] {
  return [
    "Compare the Talabat merchant portal hours with the tablet status for the flagged days and fix whichever side is wrong.",
    "Complete the tablet check-in at opening and keep the tablet powered and online all trading hours.",
    "Keep the store network connection stable during trading hours and confirm the channel shows reachable.",
    "Check how holidays and busy periods are handled in the merchant portal you use, so the store is not closed for you.",
    "Name one opener and one closer to confirm open status in the first and last trading hour.",
  ];
}

function talabatCancellationGeneralSteps(channelName: string): readonly string[] {
  return [
    `In the ${channelName} merchant portal you use, check the flagged days and confirm which cancellations were avoidable.`,
    "Complete the tablet check-in at opening and keep the tablet powered and online all trading hours.",
    `Confirm the ${channelName} store shows open and reachable for the full scheduled window.`,
    "Assign one person to watch incoming orders during peak hours so none expire unanswered.",
  ];
}

function talabatAvailabilitySteps(): readonly string[] {
  return [
    "Compare the merchant portal hours with the tablet status for the days flagged closed and fix whichever side is wrong.",
    "Complete the tablet check-in at opening and keep the tablet powered and online all trading hours.",
    "Keep the store network connection stable during trading hours and confirm the channel shows reachable.",
    "Check how holidays and busy periods are handled in the merchant portal you use, so the store is not closed for you.",
  ];
}

function genericMarketplaceSteps(channelName: string): readonly string[] {
  return [
    `Compare the ${channelName} portal hours with the tablet status for the flagged days and fix whichever side is wrong.`,
    "Complete the tablet check-in at opening and keep the tablet powered and online all trading hours.",
    "Keep the store network connection stable during trading hours.",
  ];
}

/**
 * Selects curated guidance for one narration run.
 *
 * Pure: the same channel identity plus the same detector keys and reason
 * labels always returns the same items in the same order. Unknown channels
 * get the generic marketplace wording with their own display name; unknown
 * detectors get nothing.
 */
export function selectPlaybookGuidance(input: {
  channelKey: string;
  templateKey: string | null;
  channelDisplayName: string;
  detectorKeys: readonly string[];
  reasonLabels?: readonly string[];
}): readonly PlaybookGuidanceItem[] {
  const distinctDetectors = [...new Set(input.detectorKeys)].filter((key) =>
    PILOT_PLAYBOOK_DETECTOR_KEYS.has(key),
  );
  if (distinctDetectors.length === 0) return [];

  const channelName = input.channelDisplayName.trim() || "marketplace";
  const talabat = isTalabatChannel({
    channelKey: input.channelKey,
    templateKey: input.templateKey,
  });
  const reasons = input.reasonLabels ?? [];
  const items: PlaybookGuidanceItem[] = [];

  for (const detectorKey of distinctDetectors.sort()) {
    if (detectorKey === "operations.closed_share") {
      items.push({
        detectorKey,
        title: talabat ? "Talabat availability checks" : `${channelName} availability checks`,
        steps: talabat ? talabatAvailabilitySteps() : genericMarketplaceSteps(channelName),
        sourceLabel: talabat
          ? "Curated Talabat operations checklist"
          : "Curated marketplace operations checklist",
      });
      continue;
    }
    const closed = hasClosedReason(reasons);
    items.push({
      detectorKey,
      title:
        talabat && closed
          ? "Talabat closed-cancellation checks"
          : talabat
            ? "Talabat cancellation checks"
            : `${channelName} cancellation checks`,
      steps:
        talabat && closed
          ? talabatCancellationClosedSteps()
          : talabat
            ? talabatCancellationGeneralSteps(channelName)
            : genericMarketplaceSteps(channelName),
      sourceLabel: talabat
        ? "Curated Talabat operations checklist"
        : "Curated marketplace operations checklist",
    });
  }

  return items;
}
