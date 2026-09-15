import { z } from "zod";

/**
 * What the provider has reported about this campaign's published posts.
 *
 * Read on the caller's own session, so row level security decides what a member
 * sees. Three flat reads matched in memory rather than one nested select, which
 * is how every other repository here reads related rows.
 *
 * Two things this reader will not do.
 *
 * It does not fill gaps. An observation recorded `absent` means the provider
 * was asked and reported nothing, and it stays absent all the way to the chart.
 * A missing row means nobody has asked yet, which is a different statement
 * again, and neither becomes a zero on the way through.
 *
 * It does not combine readings. Every organic figure is a lifetime running
 * total for one post, registered with `last` precisely because adding two
 * readings together would multiply one post's reach by how often it was
 * collected. The series is a sequence of snapshots, and the newest one is the
 * current answer.
 */

type Row = Record<string, unknown>;
type Result = { data: Row[] | null; error: { message?: string } | null };

type Filter = {
  eq(column: string, value: string): Filter & PromiseLike<Result>;
  in(column: string, values: readonly string[]): Filter & PromiseLike<Result>;
  is(column: string, value: null): Filter & PromiseLike<Result>;
};

export type PostPerformancePersistence = {
  from(
    table:
      | "campaign_metric_observations"
      | "normalized_metrics"
      | "metric_definitions"
      | "campaign_action_runs"
      | "campaign_channel_actions",
  ): { select(columns: string): Filter & PromiseLike<Result> };
};

const observationSchema = z.object({
  action_run_id: z.string().uuid().nullable(),
  metric_definition_id: z.string().uuid(),
  normalized_metric_id: z.string().uuid().nullable(),
  period_start: z.string(),
  presence: z.enum(["observed", "absent"]),
});

const definitionSchema = z.object({
  id: z.string().uuid(),
  key: z.string().min(1),
  label: z.string().min(1),
});

const valueSchema = z.object({
  id: z.string().uuid(),
  value_numerator: z.union([z.number(), z.string()]),
});

export type PostPerformancePoint = {
  metricKey: string;
  label: string;
  /** The instant the day this reading belongs to began, in the org timezone. */
  observedAt: string;
  presence: "observed" | "absent";
  /** Null whenever the provider reported nothing. Never defaulted to zero. */
  value: number | null;
};

export type PostPerformanceSeries = {
  /** The published action these readings belong to. */
  actionRunId: string;
  /**
   * Where it went, so two posts in one campaign are never read as one.
   *
   * Null when the action behind the readings cannot be read. The figures are
   * still shown, because they are real; only the name for them is missing.
   */
  channel: string | null;
  placement: string | null;
  points: readonly PostPerformancePoint[];
};

export async function readCampaignPostPerformance(
  persistence: PostPerformancePersistence,
  input: { organizationId: string; campaignId: string },
): Promise<readonly PostPerformanceSeries[]> {
  const observationsResult = await persistence
    .from("campaign_metric_observations")
    .select(
      "action_run_id, metric_definition_id, normalized_metric_id, period_start, presence",
    )
    .eq("organization_id", input.organizationId)
    .eq("campaign_id", input.campaignId)
    // Only the live answer for each subject, metric and period. A superseded
    // row is what a restatement replaced, and showing both would present one
    // correction as two measurements.
    .is("superseded_by_id", null);
  if (observationsResult.error) {
    throw new Error("This campaign's reported results could not be read.");
  }

  const observations = (observationsResult.data ?? [])
    .map((row) => observationSchema.safeParse(row))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
    .filter((row) => row.action_run_id !== null);
  if (observations.length === 0) return [];

  const definitions = await readById(
    persistence,
    "metric_definitions",
    "id, key, label",
    observations.map((row) => row.metric_definition_id),
    definitionSchema,
  );

  const values = await readById(
    persistence,
    "normalized_metrics",
    "id, value_numerator",
    observations.flatMap((row) => (row.normalized_metric_id ? [row.normalized_metric_id] : [])),
    valueSchema,
  );

  const byAction = new Map<string, PostPerformancePoint[]>();
  for (const observation of observations) {
    const definition = definitions.get(observation.metric_definition_id);
    // A figure whose metric cannot be named is not shown. A number with no
    // label is not a measurement anyone can act on.
    if (!definition) continue;

    const raw =
      observation.normalized_metric_id === null
        ? null
        : values.get(observation.normalized_metric_id);
    const value = raw === undefined || raw === null ? null : Number(raw.value_numerator);
    const usable = observation.presence === "observed" && value !== null && Number.isFinite(value);

    const points = byAction.get(observation.action_run_id as string) ?? [];
    points.push({
      metricKey: definition.key,
      label: definition.label,
      observedAt: observation.period_start,
      // An observed row whose value will not read is downgraded to absent
      // rather than shown as zero: the reading exists, the number does not.
      presence: usable ? "observed" : "absent",
      value: usable ? value : null,
    });
    byAction.set(observation.action_run_id as string, points);
  }

  const placements = await readPlacements(persistence, [...byAction.keys()]);

  return [...byAction.entries()].map(([actionRunId, points]) => ({
    actionRunId,
    channel: placements.get(actionRunId)?.channel ?? null,
    placement: placements.get(actionRunId)?.placement ?? null,
    points: points.sort(
      (left, right) =>
        Date.parse(left.observedAt) - Date.parse(right.observedAt) ||
        left.metricKey.localeCompare(right.metricKey),
    ),
  }));
}

const runSchema = z.object({
  id: z.string().uuid(),
  bundle_version_id: z.string().uuid(),
  action_key: z.string().uuid(),
});

const placementSchema = z.object({
  bundle_version_id: z.string().uuid(),
  action_key: z.string().uuid(),
  channel: z.string().min(1),
  placement: z.string().min(1),
});

/**
 * Where each post went, resolved through the action it ran.
 *
 * Failure here loses the label and nothing else: the figures are real whether
 * or not the action row can be read, so they are still returned.
 */
async function readPlacements(
  persistence: PostPerformancePersistence,
  actionRunIds: readonly string[],
): Promise<Map<string, { channel: string; placement: string }>> {
  const resolved = new Map<string, { channel: string; placement: string }>();
  if (actionRunIds.length === 0) return resolved;

  const runsResult = await persistence
    .from("campaign_action_runs")
    .select("id, bundle_version_id, action_key")
    .in("id", [...new Set(actionRunIds)]);
  if (runsResult.error) return resolved;

  const runs = (runsResult.data ?? [])
    .map((row) => runSchema.safeParse(row))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
  if (runs.length === 0) return resolved;

  const actionsResult = await persistence
    .from("campaign_channel_actions")
    .select("bundle_version_id, action_key, channel, placement")
    .in("bundle_version_id", [...new Set(runs.map((run) => run.bundle_version_id))]);
  if (actionsResult.error) return resolved;

  const actions = new Map<string, { channel: string; placement: string }>();
  for (const row of actionsResult.data ?? []) {
    const parsed = placementSchema.safeParse(row);
    if (!parsed.success) continue;
    actions.set(`${parsed.data.bundle_version_id}:${parsed.data.action_key}`, {
      channel: parsed.data.channel,
      placement: parsed.data.placement,
    });
  }

  for (const run of runs) {
    const action = actions.get(`${run.bundle_version_id}:${run.action_key}`);
    if (action) resolved.set(run.id, action);
  }
  return resolved;
}

async function readById<Schema extends z.ZodType<{ id: string }>>(
  persistence: PostPerformancePersistence,
  table: "normalized_metrics" | "metric_definitions",
  columns: string,
  ids: readonly string[],
  schema: Schema,
): Promise<Map<string, z.infer<Schema>>> {
  const resolved = new Map<string, z.infer<Schema>>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return resolved;

  const result = await persistence.from(table).select(columns).in("id", unique);
  if (result.error) return resolved;

  for (const row of result.data ?? []) {
    const parsed = schema.safeParse(row);
    if (parsed.success) resolved.set(parsed.data.id, parsed.data);
  }
  return resolved;
}
