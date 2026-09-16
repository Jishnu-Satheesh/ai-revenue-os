import { z } from "zod";

/**
 * Transparent action scenario for the organization-home revenue section.
 *
 * Companion spec:
 * `docs/superpowers/specs/2026-09-11-organization-home-revenue-scenario.md`
 * (§§2–9, §14 selections, §16 amendment). Draft ADR:
 * `docs/superpowers/plans/2026-09-11-organization-home-revenue-adr-draft.md`.
 *
 * What this module is: a deterministic function over listed inputs — reported
 * history, observed loss findings, and the §14(a) action set — for a
 * next-month conditional chart. Same inputs always give the same chart; every
 * unit of uplift traces to a listed parameter.
 *
 * What this module never does:
 * - It never compounds the latest percentage change forward.
 * - It never maps money-split `potential`/`earned` to a future figure.
 * - It never sums `value.ts` ranking quantities, campaign-draft-impact
 *   validations, measurement verdicts, or fixtures into the headline.
 * - It never invents response rates, amounts, confidence, or shares. An
 *   assumption range arrives as an explicit validated parameter bound to a
 *   cited input, or the action stays "not yet quantified".
 * - It never calls a model, a tool, storage, or the network. Proposed ranges
 *   arrive through `applyProposedRanges`, which attaches only schema-valid
 *   rows citing a listed finding and leaves everything else unquantified.
 *   The live model-proposal route (low temperature, no tools, strict schema,
 *   failure to hold-current-level) belongs to a later slice after amendment
 *   approval.
 */

export const revenueScenarioGrainSchema = z.enum(["period", "week", "month", "day"]);
export type RevenueScenarioGrain = z.output<typeof revenueScenarioGrainSchema>;

export const revenueHistoryPointSchema = z.strictObject({
  label: z.string().trim().min(1).max(80),
  minorUnits: z.number().int().min(0),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase()),
});
export type RevenueHistoryPoint = z.output<typeof revenueHistoryPointSchema>;

export const revenueLossFindingSchema = z.strictObject({
  findingId: z.string().uuid(),
  minorUnits: z.number().int().min(0),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase()),
});
export type RevenueLossFinding = z.output<typeof revenueLossFindingSchema>;

/**
 * One AI-proposed response fraction range, bound to a cited input.
 *
 * `low`/`high` are fractions of `citedBasisMinorUnits` (0 = no effect,
 * 1 = full cited basis). A range that cites no input is rejected like a
 * malformed row: the action stays unquantified and never blocks the rest.
 */
export const revenueAssumptionRangeSchema = z
  .strictObject({
    actionId: z.string().trim().min(1).max(120),
    citedFindingId: z.string().uuid(),
    citedBasisMinorUnits: z.number().int().min(0),
    currency: z
      .string()
      .trim()
      .length(3)
      .transform((value) => value.toUpperCase()),
    low: z.number().min(0).max(1),
    high: z.number().min(0).max(1),
  })
  .refine((value) => value.low <= value.high, {
    message: "Assumption low must not exceed high.",
  });
export type RevenueAssumptionRange = z.output<typeof revenueAssumptionRangeSchema>;

export const revenueScenarioActionSchema = z.strictObject({
  id: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(200),
  kind: z.enum(["recommendation", "proposal", "insight"]),
  /** Actual lifecycle state from the owning workspace; shown verbatim. */
  status: z.string().trim().min(1).max(80),
  href: z.string().trim().min(1).max(500).nullable(),
  /** Null means the action has no cited monetary basis yet. */
  citedFindingId: z.string().uuid().nullable(),
  citedBasisMinorUnits: z.number().int().min(0).nullable(),
  citedCurrency: z
    .string()
    .trim()
    .length(3)
    .transform((value) => value.toUpperCase())
    .nullable(),
  /** Null means no supported response basis yet; the action stays unquantified. */
  assumptionLow: z.number().min(0).max(1).nullable(),
  assumptionHigh: z.number().min(0).max(1).nullable(),
});
export type RevenueScenarioAction = z.output<typeof revenueScenarioActionSchema>;

export const revenueScenarioInputSchema = z.strictObject({
  organizationId: z.string().uuid(),
  /** Supported reporting grain; period totals render as points/bars, never a smooth daily curve. */
  grain: revenueScenarioGrainSchema,
  history: z.array(revenueHistoryPointSchema).max(24),
  losses: z.array(revenueLossFindingSchema).max(24),
  actions: z.array(revenueScenarioActionSchema).max(50),
  /** Inclusive local date of the last observation feeding the baseline. */
  lastObservationDate: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/),
  /** Inclusive local date the section is rendered for. */
  today: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/),
  /** Human-readable source cutoff, e.g. which reports through which date. */
  cutoffNote: z.string().trim().min(1).max(300),
  /** Coverage line, e.g. which channels the history covers. */
  coverageNote: z.string().trim().min(1).max(300),
});
export type RevenueScenarioInput = z.output<typeof revenueScenarioInputSchema>;

export type RevenueScenarioShare = {
  actionId: string;
  title: string;
  /** Actual lifecycle state from the owning workspace; shown verbatim. */
  status: string;
  href: string | null;
  lowMinorUnits: number;
  highMinorUnits: number;
  /** Share of the combined increment; null when the combined increment is zero. */
  shareLow: number | null;
  shareHigh: number | null;
  citedFindingId: string;
  jointGroup: boolean;
};

export type RevenueScenarioUnquantified = {
  actionId: string;
  title: string;
  kind: RevenueScenarioAction["kind"];
  status: string;
  href: string | null;
  reason: string;
};

export type RevenueScenarioReady = {
  state: "ready";
  currency: string;
  grain: RevenueScenarioGrain;
  horizonLabel: string;
  baselineMinorUnits: number;
  baselineMethod: "hold-current-level";
  history: readonly { label: string; minorUnits: number }[];
  /** Position after which the chart marks the last observation and starts the two next-month paths. */
  lastObservationBoundary: number;
  currentCourseMinorUnits: number;
  combinedLowMinorUnits: number;
  combinedHighMinorUnits: number;
  withActionsLowMinorUnits: number;
  withActionsHighMinorUnits: number;
  /** Uplift relative to the same baseline; null when the baseline is zero (no manufactured percentage). */
  upliftLowPercent: number | null;
  upliftHighPercent: number | null;
  shares: readonly RevenueScenarioShare[];
  unquantified: readonly RevenueScenarioUnquantified[];
  stalenessGap: boolean;
  gapNote: string | null;
  cutoffNote: string;
  coverageNote: string;
  roughEstimate: true;
  notes: readonly string[];
};

export type RevenueScenarioRefused = {
  state: "refused";
  reason: string;
};

export type RevenueScenario = RevenueScenarioReady | RevenueScenarioRefused;

export const MIXED_CURRENCY_REASON =
  "These sources reported in more than one currency, so no single scenario can be stated.";
export const NO_HISTORY_REASON =
  "No reported revenue history is available yet, so no scenario can be stated.";
export const HOLD_CURRENT_LEVEL_NOTE =
  "Hold-current-level scenario: the next month is shown at the latest observed level. This is a scenario, never a learned forecast.";

function daysBetween(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00.000Z`).getTime();
  const end = new Date(`${to}T00:00:00.000Z`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.round((end - start) / 86_400_000);
}

function roundShare(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/**
 * Builds the next-month conditional scenario. Pure: no I/O, no clock reads,
 * no model calls. Same inputs always give the same chart.
 */
export function buildRevenueScenario(input: RevenueScenarioInput): RevenueScenario {
  const parsed = revenueScenarioInputSchema.safeParse(input);
  if (!parsed.success) {
    return { state: "refused", reason: "The scenario inputs were not usable." };
  }
  const value = parsed.data;
  if (value.history.length === 0) {
    return { state: "refused", reason: NO_HISTORY_REASON };
  }

  const currencies = new Set([
    ...value.history.map((point) => point.currency),
    ...value.losses.map((loss) => loss.currency),
    ...value.actions
      .map((action) => action.citedCurrency)
      .filter((currency): currency is string => currency !== null),
  ]);
  if (currencies.size !== 1) {
    return { state: "refused", reason: MIXED_CURRENCY_REASON };
  }
  const [currency] = currencies;

  // Hold-current-level baseline: the latest observed level, projected flat
  // for the next month at the supported grain. Never a compounded growth
  // rate, never a learned forecast.
  const baselineMinorUnits = value.history[value.history.length - 1]!.minorUnits;

  const gapDays = daysBetween(value.lastObservationDate, value.today);
  const stalenessGap = gapDays > 0;
  const gapNote = stalenessGap
    ? `Last observation ${value.lastObservationDate}; ${gapDays} day${gapDays === 1 ? "" : "s"} before today. Shown as a gap, not hidden.`
    : null;

  const knownFindingIds = new Set([...value.losses.map((loss) => loss.findingId)]);

  type Quantified = {
    action: RevenueScenarioAction;
    lowMinorUnits: number;
    highMinorUnits: number;
    citedFindingId: string;
  };
  const quantifiedCandidates: Quantified[] = [];
  const unquantified: RevenueScenarioUnquantified[] = [];

  for (const action of value.actions) {
    if (
      action.citedFindingId === null ||
      action.citedBasisMinorUnits === null ||
      action.citedCurrency === null ||
      action.assumptionLow === null ||
      action.assumptionHigh === null
    ) {
      unquantified.push({
        actionId: action.id,
        title: action.title,
        kind: action.kind,
        status: action.status,
        href: action.href,
        reason: "Not yet quantified: no cited monetary basis with a supported response range yet.",
      });
      continue;
    }
    if (action.citedCurrency !== currency) {
      unquantified.push({
        actionId: action.id,
        title: action.title,
        kind: action.kind,
        status: action.status,
        href: action.href,
        reason: "Not yet quantified: its cited basis is in another currency.",
      });
      continue;
    }
    if (!knownFindingIds.has(action.citedFindingId)) {
      // A range that cites no listed input is rejected like a malformed row.
      unquantified.push({
        actionId: action.id,
        title: action.title,
        kind: action.kind,
        status: action.status,
        href: action.href,
        reason: "Not yet quantified: its range cites an input outside this scenario.",
      });
      continue;
    }
    if (action.assumptionLow > action.assumptionHigh) {
      unquantified.push({
        actionId: action.id,
        title: action.title,
        kind: action.kind,
        status: action.status,
        href: action.href,
        reason: "Not yet quantified: its assumption range is not usable.",
      });
      continue;
    }
    // Past loss caps the estimate: a fraction of the cited basis can never
    // exceed the basis itself, and the basis is past loss, never a promise
    // of full recovery.
    const lowMinorUnits = Math.min(
      Math.round(action.citedBasisMinorUnits * action.assumptionLow),
      action.citedBasisMinorUnits,
    );
    const highMinorUnits = Math.min(
      Math.round(action.citedBasisMinorUnits * action.assumptionHigh),
      action.citedBasisMinorUnits,
    );
    quantifiedCandidates.push({
      action,
      lowMinorUnits,
      highMinorUnits,
      citedFindingId: action.citedFindingId,
    });
  }

  // Joint groups: actions citing the same finding share one figure until a
  // defensible allocation rule is approved. Within a group the shared figure
  // is the member maximum, never the sum — a flagged overlap the calculator
  // still adds would still be double-counting.
  const byFinding = new Map<string, Quantified[]>();
  for (const candidate of quantifiedCandidates) {
    const group = byFinding.get(candidate.citedFindingId);
    if (group) group.push(candidate);
    else byFinding.set(candidate.citedFindingId, [candidate]);
  }

  const shares: RevenueScenarioShare[] = [];
  let combinedLowMinorUnits = 0;
  let combinedHighMinorUnits = 0;
  for (const [, group] of byFinding) {
    const jointGroup = group.length > 1;
    const groupLow = Math.max(...group.map((member) => member.lowMinorUnits));
    const groupHigh = Math.max(...group.map((member) => member.highMinorUnits));
    combinedLowMinorUnits += groupLow;
    combinedHighMinorUnits += groupHigh;
    for (const member of group) {
      // Each member's displayed increment is its share of the joint figure
      // only when it is the group maximum; other members of a joint group
      // carry the joint figure once at the group level and are marked so the
      // surface can show one shared figure instead of adding them twice.
      const isGroupMax = member.lowMinorUnits === groupLow && member.highMinorUnits === groupHigh;
      shares.push({
        actionId: member.action.id,
        title: member.action.title,
        status: member.action.status,
        href: member.action.href,
        lowMinorUnits: isGroupMax ? groupLow : member.lowMinorUnits,
        highMinorUnits: isGroupMax ? groupHigh : member.highMinorUnits,
        shareLow: null,
        shareHigh: null,
        citedFindingId: member.citedFindingId,
        jointGroup,
      });
    }
  }

  // Shares reconcile to the combined increment. The high bound reconciles
  // exactly (sum of group highs). The low bound is shown as a proportion of
  // that same high total, so low shares sum to combinedLow/combinedHigh and
  // never overstate the conservative end. Joint groups carry joint shares
  // per §7/§9 until an allocation rule is approved — the jointGroup flag
  // tells the surface to render one shared figure, never to add the rows.
  // Zero combined totals keep null shares so no percentage is manufactured.
  const withShares: RevenueScenarioShare[] =
    combinedLowMinorUnits <= 0 && combinedHighMinorUnits <= 0
      ? shares
      : shares.map((share) => ({
          ...share,
          shareLow: roundShare(share.lowMinorUnits, combinedHighMinorUnits),
          shareHigh: roundShare(share.highMinorUnits, combinedHighMinorUnits),
        }));

  const withActionsLowMinorUnits = baselineMinorUnits + combinedLowMinorUnits;
  const withActionsHighMinorUnits = baselineMinorUnits + combinedHighMinorUnits;
  const upliftLowPercent =
    baselineMinorUnits === 0
      ? null
      : Math.round((combinedLowMinorUnits / baselineMinorUnits) * 1000) / 10;
  const upliftHighPercent =
    baselineMinorUnits === 0
      ? null
      : Math.round((combinedHighMinorUnits / baselineMinorUnits) * 1000) / 10;

  const notes: string[] = [HOLD_CURRENT_LEVEL_NOTE];
  if (unquantified.length > 0) {
    notes.push(
      `${unquantified.length} action${unquantified.length === 1 ? "" : "s"} not yet quantified; shown beside the scenario, never as zero.`,
    );
  }
  if (byFinding.size > 0 && [...byFinding.values()].some((group) => group.length > 1)) {
    notes.push(
      "Joint group shown as one shared figure where actions cite the same evidence; no upside is counted twice.",
    );
  }
  if (baselineMinorUnits === 0) {
    notes.push("The baseline is zero, so no uplift percentage is stated — only amounts.");
  }

  return {
    state: "ready",
    currency,
    grain: value.grain,
    horizonLabel: "Next month (≈30 days)",
    baselineMinorUnits,
    baselineMethod: "hold-current-level",
    history: value.history.map((point) => ({ label: point.label, minorUnits: point.minorUnits })),
    lastObservationBoundary: value.history.length - 1,
    currentCourseMinorUnits: baselineMinorUnits,
    combinedLowMinorUnits,
    combinedHighMinorUnits,
    withActionsLowMinorUnits,
    withActionsHighMinorUnits,
    upliftLowPercent,
    upliftHighPercent,
    shares: withShares,
    unquantified,
    stalenessGap,
    gapNote,
    cutoffNote: value.cutoffNote,
    coverageNote: value.coverageNote,
    roughEstimate: true,
    notes,
  };
}

export type RevenueProposedRangeRejection = {
  actionId: string;
  reason: string;
};

/**
 * Attaches validated assumption ranges to the §14(a) action set. Pure and
 * deterministic: same actions plus same ranges always give the same set.
 *
 * This is the deterministic half of the §16 amendment. A model (or any other
 * proposer) may suggest ranges, but nothing is attached unless it parses as
 * a `revenueAssumptionRangeSchema` row citing a listed finding. Rejected
 * ranges leave the action exactly as it was — still visible downstream as
 * "not yet quantified", never zeroed, never blocking the rest. The last
 * valid range for an action wins, so repeated proposals stay order-defined.
 * Final quantification still belongs to `buildRevenueScenario`, which
 * re-checks currency and citation before any figure ships.
 */
export function applyProposedRanges(
  actions: readonly RevenueScenarioAction[],
  ranges: readonly unknown[],
  knownFindingIds: ReadonlySet<string>,
): {
  actions: RevenueScenarioAction[];
  rejected: RevenueProposedRangeRejection[];
} {
  const nextById = new Map(actions.map((action) => [action.id, { ...action }]));
  const rejected: RevenueProposedRangeRejection[] = [];

  for (const raw of ranges) {
    const parsed = revenueAssumptionRangeSchema.safeParse(raw);
    if (!parsed.success) {
      const candidateId =
        typeof raw === "object" &&
        raw !== null &&
        "actionId" in raw &&
        typeof raw.actionId === "string"
          ? raw.actionId
          : "unknown";
      rejected.push({
        actionId: candidateId,
        reason: "Not usable: the proposed range is not usable.",
      });
      continue;
    }
    const range = parsed.data;
    if (!knownFindingIds.has(range.citedFindingId)) {
      rejected.push({
        actionId: range.actionId,
        reason: "Not yet quantified: its range cites an input outside this scenario.",
      });
      continue;
    }
    const target = nextById.get(range.actionId);
    if (!target) {
      rejected.push({
        actionId: range.actionId,
        reason: "No listed action matches this proposed range.",
      });
      continue;
    }
    nextById.set(range.actionId, {
      ...target,
      citedFindingId: range.citedFindingId,
      citedBasisMinorUnits: range.citedBasisMinorUnits,
      citedCurrency: range.currency,
      assumptionLow: range.low,
      assumptionHigh: range.high,
    });
  }

  return { actions: [...nextById.values()], rejected };
}
