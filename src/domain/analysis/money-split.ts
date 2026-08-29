/**
 * The earned / lost / potential split, in one place.
 *
 * `potential` is the channel's reported gross revenue, `lost` is the provider's
 * own recorded rejection loss, and `earned` is potential minus lost. It is a
 * stated relationship between two already-cited figures, never a new
 * measurement, which is why it refuses rather than guesses whenever the two
 * figures cannot honestly be subtracted.
 *
 * The channel workspace and the organization-wide roll-up both call this. One
 * implementation is the point: two would drift, and the page would then show a
 * channel one number and its own total another.
 */

export type AnalysisMoney = { minorUnits: number; currency: string };

export type EarnedLostPotential = {
  potential: AnalysisMoney | null;
  lost: AnalysisMoney | null;
  earned: AnalysisMoney | null;
};

/**
 * Which of the three things this channel's evidence can actually say.
 *
 * `revenue_only` exists because not every provider records what a channel
 * lost. Talabat states its own rejection loss; Keeta's export states what was
 * sold and nothing else. Both of those are successful analyses, and folding the
 * second one into the same answer as "no analysis exists" told an operator
 * their import had achieved nothing.
 *
 * `refused` is narrower than it was: it means there is no revenue figure at
 * all, or there is a loss that cannot honestly be subtracted from one. A loss
 * that is real but incomparable stays a refusal rather than quietly becoming
 * `revenue_only`, because dropping a figure the provider did state would be its
 * own kind of lie.
 */
export type ChannelMoneyState = "complete" | "revenue_only" | "refused";

export type ChannelMoney = EarnedLostPotential & { state: ChannelMoneyState };

const REFUSED: EarnedLostPotential = { potential: null, lost: null, earned: null };

/**
 * The full account of what this channel's two figures support.
 *
 * Callers that can render three states should use this. Callers that can only
 * show a completed split should use `splitEarnedLostPotential`, which is
 * defined in terms of this function so the subtraction itself exists once.
 */
export function describeChannelMoney(input: {
  potential: AnalysisMoney | null;
  lost: AnalysisMoney | null;
}): ChannelMoney {
  const { potential, lost } = input;
  if (potential === null) return { ...REFUSED, state: "refused" };
  // Revenue is reported and nothing measured a loss against it. The absent
  // halves stay null: an unmeasured loss is not a zero one, and `earned` is
  // not silently set to the whole of `potential`.
  if (lost === null) return { potential, lost: null, earned: null, state: "revenue_only" };
  if (potential.currency !== lost.currency) return { ...REFUSED, state: "refused" };
  if (potential.minorUnits < lost.minorUnits) return { ...REFUSED, state: "refused" };
  return {
    state: "complete",
    potential,
    lost,
    earned: { minorUnits: potential.minorUnits - lost.minorUnits, currency: potential.currency },
  };
}

/**
 * The strict view: the split, or nothing.
 *
 * A caller getting this back cannot tell a revenue-only channel from an unread
 * one, and must not try to — returning a partial split would let it render
 * `potential` beside a blank `earned` and imply the subtraction simply came to
 * nothing. Where that distinction matters, call `describeChannelMoney`.
 */
export function splitEarnedLostPotential(input: {
  potential: AnalysisMoney | null;
  lost: AnalysisMoney | null;
}): EarnedLostPotential {
  const { state, ...figures } = describeChannelMoney(input);
  return state === "complete" ? figures : REFUSED;
}
