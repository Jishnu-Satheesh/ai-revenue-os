import { fromMinorUnits } from "@/domain/reference/currencies";
import type {
  CampaignProposalCardView,
  CampaignProposalDecisionKind,
} from "@/modules/campaigns/application/proposal-read-model";
import type { CampaignProposalState } from "@/domain/campaigns/proposal";

/**
 * The words the proposal surfaces use, in one place.
 *
 * Both the card and the review page name the same states, the same amounts and
 * the same decisions, and two copies of that vocabulary is how a card ends up
 * saying "Approved" while the page it links to says "Approved for preparation".
 * Those are not the same claim.
 */

/**
 * What a state means to the person reading it.
 *
 * `approved_for_preparation` keeps its full length on purpose. "Approved" on
 * its own reads as "cleared to publish", which is exactly the misunderstanding
 * `adrs/0057-campaign-preparation-approval-vs-exact-output-publication.md`
 * exists to prevent.
 */
export function proposalStateLabel(state: CampaignProposalState): string {
  switch (state) {
    case "researching":
      return "Being researched";
    case "needs_input":
      return "Needs more information";
    case "ready_for_review":
      return "Ready for your decision";
    case "changes_requested":
      return "Changes requested";
    case "approved_for_preparation":
      return "Approved to prepare creative";
    case "snoozed":
      return "Snoozed";
    case "dismissed":
      return "Dismissed";
    case "superseded":
      return "Replaced by a newer proposal";
    case "cancelled":
      return "Cancelled";
  }
}

/** The sentence under the state, saying what is actually happening. */
export function proposalStateDetail(card: CampaignProposalCardView): string {
  switch (card.state) {
    case "researching":
      return "The platform is still working out whether there is anything worth doing here. Nothing has been written yet.";
    case "needs_input":
      return "The research could not finish on its own. Nothing has been proposed and nothing has been spent.";
    case "ready_for_review":
      return "Someone needs to read this and decide. Nothing has been made yet.";
    case "changes_requested":
      return "Changes were asked for. A new version has to be written before this can be decided again.";
    case "approved_for_preparation":
      return card.linkedCampaignId === null
        ? "Creative preparation was authorized, but the campaign it opened cannot be linked from here."
        : "Creative preparation was authorized. Nothing has been published, and publishing needs its own approval.";
    case "snoozed":
      return "Set aside for now. It can be decided again at any time.";
    case "dismissed":
      return "Turned down. Nothing was made and nothing was spent.";
    case "superseded":
      return "A newer version of this proposal replaced it.";
    case "cancelled":
      return "This proposal was cancelled before it was decided.";
  }
}

export function proposalDecisionLabel(decision: CampaignProposalDecisionKind): string {
  switch (decision) {
    case "approved_for_preparation":
      return "Approved to prepare creative";
    case "changes_requested":
      return "Changes requested";
    case "snoozed":
      return "Snoozed";
    case "dismissed":
      return "Dismissed";
  }
}

/**
 * An amount with its currency, or the reason there isn't one.
 *
 * `null` here means the proposal states there is no media budget — an
 * organic-only campaign — and that is a different fact from a budget of zero.
 * Rendering it as "0.00" would claim somebody set a budget and set it to
 * nothing.
 */
export function formatProposalMoney(
  money: { amountMinor: number; currency: string } | null,
  absent: string,
): string {
  if (money === null) return absent;
  return `${money.currency} ${fromMinorUnits(money.amountMinor, money.currency)}`;
}

export function formatProposalDay(value: string, timeZone: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatProposalMoment(value: string, timeZone: string): string {
  return new Date(value).toLocaleString("en-GB", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "2 organic, 1 paid" — never a bare channel count, which hides the money. */
export function summarizeChannels(
  channels: readonly { channelKey: string; delivery: "organic" | "paid" }[],
): string {
  const organic = channels.filter((channel) => channel.delivery === "organic").length;
  const paid = channels.filter((channel) => channel.delivery === "paid").length;
  const parts: string[] = [];
  if (organic > 0) parts.push(`${organic} organic`);
  if (paid > 0) parts.push(`${paid} paid`);
  return parts.length === 0 ? "No channels named" : parts.join(", ");
}
