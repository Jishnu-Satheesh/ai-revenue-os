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

const REFUSED: EarnedLostPotential = { potential: null, lost: null, earned: null };

export function splitEarnedLostPotential(input: {
  potential: AnalysisMoney | null;
  lost: AnalysisMoney | null;
}): EarnedLostPotential {
  const { potential, lost } = input;
  // All three refusals state the same thing: these two figures cannot be
  // subtracted honestly, so no part of the split is offered. Returning a
  // partial split would let a caller render `potential` beside a blank
  // `earned` and imply the subtraction simply came to nothing.
  if (potential === null || lost === null) return REFUSED;
  if (potential.currency !== lost.currency) return REFUSED;
  if (potential.minorUnits < lost.minorUnits) return REFUSED;
  return {
    potential,
    lost,
    earned: { minorUnits: potential.minorUnits - lost.minorUnits, currency: potential.currency },
  };
}
