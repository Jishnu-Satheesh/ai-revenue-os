import { z } from "zod";

/**
 * Writing a collected provider figure into the campaign metric grain.
 *
 * This is the translation between what a provider reader produced and what the
 * database accepts. The interesting decisions are all here rather than in the
 * reader, because they are platform concerns, not Meta concerns.
 *
 * - The subject is typed: a figure is attached to a variant, an action run, or
 *   a campaign that exists in the same organization, and the RPC enforces the
 *   composite keys. A uuid that names nothing, or names another tenant, fails.
 * - Only the money metric carries a currency. A count with a currency, or money
 *   without one, violates the warehouse's declarative value checks, so the
 *   distinction is made here rather than left to the caller.
 * - A gap is passed through as `absent` with no value, never converted into a
 *   zero. The distinction between "the provider reported nothing" and "we
 *   measured zero" is the whole reason the grain table exists.
 *
 * Re-running a collection over a settled window is normal operation. The RPC
 * returns `unchanged` for a figure the provider repeated, so a second sweep
 * writes nothing rather than producing a second current answer.
 */

export type CampaignMetricSubject =
  | { kind: "campaign" }
  | { kind: "campaign_action"; actionRunId: string }
  | { kind: "creative_variant"; variantId: string };

export type CampaignMetricPoint = {
  organizationId: string;
  campaignId: string;
  subject: CampaignMetricSubject;
  channel: string | null;
  metricKey: string;
  periodStart: string;
  periodEnd: string;
  periodTimezone: string;
  presence: "observed" | "absent";
  /** Integer in platform units: minor for money, whole for counts. Null when absent. */
  valueMinor: number | null;
  currency: string | null;
  qualityTier: "measured" | "derived" | "estimated" | "assumed";
  collectionRunId: string;
  observedAt: string;
};

export type RecordOutcome = {
  outcome: "recorded" | "restated" | "unchanged";
  observationId: string;
  revision?: number;
};

export type CampaignMetricIngestPersistence = {
  rpc(
    name: "record_campaign_metric_observation",
    args: { target_organization_id: string; input_observation: Record<string, unknown> },
  ): Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
};

const recordResultSchema = z.object({
  outcome: z.enum(["recorded", "restated", "unchanged"]),
  observation_id: z.string().uuid(),
  revision: z.number().int().positive().optional(),
});

/** The one diagnostic the registry declares as money. */
const MONEY_METRIC_KEYS = new Set(["delivery.spend"]);

export function createCampaignMetricIngest(persistence: CampaignMetricIngestPersistence) {
  return {
    async record(point: CampaignMetricPoint): Promise<RecordOutcome> {
      const input_observation = {
        metric_key: point.metricKey,
        subject_kind: point.subject.kind,
        campaign_id: point.campaignId,
        variant_id: point.subject.kind === "creative_variant" ? point.subject.variantId : null,
        action_run_id: point.subject.kind === "campaign_action" ? point.subject.actionRunId : null,
        presence: point.presence,
        period_grain: "day",
        period_start: point.periodStart,
        period_end: point.periodEnd,
        period_timezone: point.periodTimezone,
        value_numerator: point.presence === "observed" ? point.valueMinor : null,
        currency: MONEY_METRIC_KEYS.has(point.metricKey) ? point.currency : null,
        quality_tier: point.qualityTier,
        channel: point.channel,
        observed_at: point.observedAt,
        collection_run_id: point.collectionRunId,
      };

      const { data, error } = await persistence.rpc("record_campaign_metric_observation", {
        target_organization_id: point.organizationId,
        input_observation,
      });

      if (error || data === null || data === undefined) {
        throw new Error("Campaign metric could not be recorded.");
      }

      const parsed = recordResultSchema.safeParse(data);
      if (!parsed.success) {
        throw new Error("Campaign metric record returned an unexpected shape.");
      }

      return {
        outcome: parsed.data.outcome,
        observationId: parsed.data.observation_id,
        ...(parsed.data.revision !== undefined ? { revision: parsed.data.revision } : {}),
      };
    },
  };
}

export type CampaignMetricIngest = ReturnType<typeof createCampaignMetricIngest>;
