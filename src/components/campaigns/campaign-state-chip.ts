/**
 * Server-safe campaign state chip resolver.
 *
 * Pure mapping with no client dependencies — safe to import from Server
 * Components. The shared card UI lives in the client component
 * `shared-campaign-card.tsx`; this module holds only the label/tone logic
 * both the organization-home summary (server) and the /campaigns portfolio
 * (client) share, so the two surfaces cannot drift apart on wording.
 */

/** The states that need a look, in the prototype's amber tag. Everything else stays green. */
const NEEDS_LOOK_STATES: ReadonlySet<string> = new Set([
  "ready_for_review",
  "needs_data",
  "blocked",
  "failed",
]);

function titleCaseState(state: string): string {
  return state
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

/**
 * The portfolio phase vocabulary, with the one fix the prototype requires:
 * the card never says bare "Needs review". Both review-bearing phases read
 * "Ready for review", matching the home wording for `ready_for_review`.
 */
const PHASE_CARD_LABEL: Readonly<Record<string, string>> = {
  proposal: "Ready for review",
  creating: "Preparing",
  review: "Ready for review",
  scheduled_live: "Live",
  results: "Completed",
  stopped: "Stopped",
};

/**
 * The state tag above the title, resolved once for both callers.
 *
 * Portfolio cards pass their list phase (and state for tone); home cards
 * pass their lifecycle state. Either way `ready_for_review` and the
 * portfolio review phases resolve to "Ready for review" in amber, drafts and
 * everything settled stay green.
 */
export function resolveCampaignStateChip(input: { state?: string | null; phase?: string | null }): {
  label: string;
  tone: "success" | "warning";
} {
  const state = input.state ?? null;
  const phase = input.phase ?? null;

  // Portfolio review-bearing phases never read bare "Needs review".
  if (phase === "proposal" || phase === "review") {
    return { label: "Ready for review", tone: "warning" };
  }
  // Otherwise the portfolio keeps its phase vocabulary ("Preparing", "Live",
  // "Completed", "Stopped"); a needs-look state only tints it amber.
  if (phase !== null) {
    const label = PHASE_CARD_LABEL[phase];
    if (label !== undefined) {
      const tone = state !== null && NEEDS_LOOK_STATES.has(state) ? "warning" : "success";
      return { label, tone };
    }
  }
  if (state === "ready_for_review") return { label: "Ready for review", tone: "warning" };
  if (state !== null && NEEDS_LOOK_STATES.has(state)) {
    return { label: titleCaseState(state), tone: "warning" };
  }
  if (state !== null) return { label: titleCaseState(state), tone: "success" };
  return { label: "Draft", tone: "success" };
}
