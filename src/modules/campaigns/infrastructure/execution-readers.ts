import { z } from "zod";

import type {
  DueAction,
  DueActionReader,
  ExposureRecorder,
} from "@/workflows/campaigns/dispatch-due-actions";
import type { MetaInsightsReader } from "@/modules/integrations/providers/meta/insights-reader";

/**
 * Which rows the execution loop should work on next.
 *
 * The five workers that run a campaign after approval were written against
 * ports and never given adapters, so nothing selected the work for them. This
 * is that selection, and it is deliberately thin: every one of these readers
 * answers "which ids are worth looking at", and the service behind it decides
 * what to do. `settleCampaign` re-checks its own eligibility window,
 * `evaluateCampaign` re-reads its own candidates, and `propose_campaign_learning`
 * refuses a campaign that has no settled outcome. A reader that tried to be
 * precise here would be a second, quieter copy of those rules.
 *
 * Everything runs as the worker, because a sweeper has no session. The list of
 * due actions is deliberately not organization-scoped for the same reason --
 * the Tool Gateway re-checks tenancy, approval and capability before anything
 * reaches a provider, so nothing selected here carries authority.
 */

type Row = Record<string, unknown>;

type Filter = {
  eq(column: string, value: string): Filter & PromiseLike<Result>;
  is(column: string, value: null): Filter & PromiseLike<Result>;
  lte(column: string, value: string): Filter & PromiseLike<Result>;
  limit(count: number): Filter & PromiseLike<Result>;
};

type Result = { data: Row[] | null; error: { message?: string } | null };

type RpcResult = { data: unknown; error: { message?: string } | null };

export type CampaignExecutionPersistence = {
  from(
    table:
      | "campaign_exposures"
      | "campaign_outcomes"
      | "campaign_approvals"
      | "integration_capability_grants"
      | "organizations",
  ): { select(columns: string): Filter & PromiseLike<Result> };
  rpc(
    name: "list_due_campaign_action_runs" | "record_campaign_exposure",
    args: Record<string, unknown>,
  ): Promise<RpcResult>;
};

const dueActionSchema = z.object({
  organization_id: z.string().uuid(),
  campaign_id: z.string().uuid(),
  bundle_version_id: z.string().uuid(),
  action_run_id: z.string().uuid(),
  action_key: z.string(),
  scheduled_for: z.string(),
});

/** Actions whose scheduled moment has passed and which nobody has sent yet. */
export function createDueActionReader(persistence: CampaignExecutionPersistence): DueActionReader {
  return {
    async listDue(limit) {
      const { data, error } = await persistence.rpc("list_due_campaign_action_runs", {
        input_limit: limit,
      });
      if (error) throw new Error("Due campaign actions could not be read.");

      const rows = z.array(dueActionSchema).safeParse(data ?? []);
      if (!rows.success) throw new Error("The due-action reader returned an unreadable result.");

      return rows.data.map(
        (row): DueAction => ({
          organizationId: row.organization_id,
          campaignId: row.campaign_id,
          bundleVersionId: row.bundle_version_id,
          actionRunId: row.action_run_id,
          actionKey: row.action_key,
          scheduledFor: row.scheduled_for,
        }),
      );
    },
  };
}

/**
 * What a provider confirmed it published.
 *
 * Written through the RPC rather than an insert, because the exposure and the
 * action run's terminal state are one fact: a row saying a post exists while the
 * run still says "sending" would make the sweeper send it twice.
 */
export function createExposureRecorder(
  persistence: CampaignExecutionPersistence,
): ExposureRecorder {
  return {
    async record(input) {
      const { error } = await persistence.rpc("record_campaign_exposure", {
        target_organization_id: input.organizationId,
        input_exposure: {
          organization_id: input.organizationId,
          action_run_id: input.actionRunId,
          external_reference: input.externalReference,
          provider_status: input.providerStatus,
          published_at: input.publishedAt,
          metrics_eligible_at: input.metricsEligibleAt,
        },
      });
      // The provider message is not surfaced: storage errors echo identifiers.
      if (error) throw new Error("The campaign exposure could not be recorded.");
    },
  };
}

function distinct(rows: Row[] | null, column: string): readonly string[] {
  const seen = new Set<string>();
  for (const row of rows ?? []) {
    const value = row[column];
    if (typeof value === "string") seen.add(value);
  }
  return [...seen];
}

export type CampaignCycleReader = {
  listActiveCampaigns(input: { organizationId: string }): Promise<readonly string[]>;
  listDueCampaigns(input: { organizationId: string }): Promise<readonly string[]>;
  listSettledCampaigns(input: { organizationId: string }): Promise<readonly string[]>;
};

export function createCampaignCycleReader(
  persistence: CampaignExecutionPersistence,
  now: () => Date = () => new Date(),
): CampaignCycleReader {
  /**
   * A campaign the platform has actually put in front of somebody.
   *
   * Exposure is the test rather than approval, and the distinction matters: an
   * approved campaign that never published has no variant to reallocate between
   * and no result to settle. Reallocating spend on a campaign that never ran
   * would be a decision about nothing.
   */
  async function exposed(organizationId: string): Promise<readonly string[]> {
    const { data, error } = await persistence
      .from("campaign_exposures")
      .select("campaign_id")
      .eq("organization_id", organizationId);
    if (error) throw new Error("Campaign exposures could not be read.");
    return distinct(data, "campaign_id");
  }

  return {
    /**
     * Live enough to reallocate.
     *
     * Revoked or expired both end the licence to spend, so a campaign under
     * either is not evaluated -- the fast loop must never move budget under an
     * approval that has lapsed. Revocation is filtered in the query because the
     * database can; expiry is compared here because it is a clock question, and
     * the same instant decides it everywhere else in this codebase.
     */
    async listActiveCampaigns({ organizationId }) {
      const { data, error } = await persistence
        .from("campaign_approvals")
        .select("campaign_id, expires_at")
        .is("revoked_at", null)
        .eq("organization_id", organizationId);
      if (error) throw new Error("Campaign approvals could not be read.");

      const at = now().getTime();
      const live = new Set(
        (data ?? [])
          .filter((row) => {
            const expiresAt = row.expires_at;
            // No expiry recorded is not "never expires": an approval the code
            // cannot date is one it cannot vouch for, so it does not count.
            if (typeof expiresAt !== "string") return false;
            return new Date(expiresAt).getTime() > at;
          })
          .map((row) => row.campaign_id)
          .filter((value): value is string => typeof value === "string"),
      );

      return (await exposed(organizationId)).filter((campaignId) => live.has(campaignId));
    },

    /**
     * Anything that has published. `settleCampaign` computes the eligibility
     * window from the campaign's own plan and returns `not_ready` when it has
     * not elapsed, so filtering by date here would duplicate that arithmetic in
     * a second place with a second chance of being wrong.
     */
    async listDueCampaigns({ organizationId }) {
      return exposed(organizationId);
    },

    /** A lesson may only be drafted from a settled outcome. */
    async listSettledCampaigns({ organizationId }) {
      const { data, error } = await persistence
        .from("campaign_outcomes")
        .select("campaign_id")
        .eq("organization_id", organizationId);
      if (error) throw new Error("Campaign outcomes could not be read.");
      return distinct(data, "campaign_id");
    },
  };
}

/**
 * The capability key Meta metrics are read under.
 *
 * Named here rather than inlined because the reader and the refusal code the
 * worker records (`meta.metrics_capability_blocked`) describe the same fact,
 * and a typo in one would look like a missing grant rather than a bug.
 */
export const META_METRICS_CAPABILITY = "read_meta_metrics";

/**
 * Whether this organization may read provider metrics at all.
 *
 * Absent is not permitted. A grant row that does not exist, is blocked, or is
 * disabled all mean the same thing to a collector: do not call the provider.
 * The worker records that as a blocked outcome rather than a failure, because
 * nothing went wrong -- the organization simply has not granted this.
 */
export function createMetricsGrantReader(persistence: CampaignExecutionPersistence) {
  return {
    async canRead(organizationId: string): Promise<boolean> {
      const { data, error } = await persistence
        .from("integration_capability_grants")
        .select("capability_key, availability")
        .eq("organization_id", organizationId)
        .eq("capability_key", META_METRICS_CAPABILITY);
      // A read that failed is not a grant. Treating an error as permission
      // would call a provider on the strength of a dropped connection.
      if (error) return false;

      return (data ?? []).some((row) => row.availability === "available");
    },
  };
}

const exposureSubjectSchema = z.object({
  organization_id: z.string().uuid(),
  campaign_id: z.string().uuid(),
  action_run_id: z.string().uuid(),
  external_reference: z.string().min(1),
  published_at: z.string(),
});

/** `YYYY-MM-DD`, which is the grain the collection window is expressed in. */
function isoDate(value: string | Date): string {
  return new Date(value).toISOString().slice(0, 10);
}

/**
 * The published things whose results are worth fetching.
 *
 * `metrics_eligible_at` is the fence, and it exists for a real reason: provider
 * insights are empty in the minutes after a post, and a zero recorded then
 * reads exactly like a measured zero. So a subject is only offered once that
 * instant has passed.
 *
 * The window runs from the day it published to today. Providers report by day,
 * and re-reading a settled day is normal -- `record_campaign_metric_observation`
 * returns `unchanged` for a figure the provider repeated, so a second sweep
 * writes nothing rather than producing a second current answer.
 */
export function createMetricSubjectReader(
  persistence: CampaignExecutionPersistence,
  now: () => Date = () => new Date(),
) {
  return {
    async listDue(limit: number) {
      const at = now();
      const { data, error } = await persistence
        .from("campaign_exposures")
        .select("organization_id, campaign_id, action_run_id, external_reference, published_at")
        .lte("metrics_eligible_at", at.toISOString())
        .limit(limit);
      if (error) throw new Error("Campaign exposures could not be read.");

      const rows = (data ?? [])
        .map((row) => exposureSubjectSchema.safeParse(row))
        .flatMap((parsed) => (parsed.success ? [parsed.data] : []));
      if (rows.length === 0) return [];

      // One read for the whole sweep rather than one per subject: currency and
      // timezone are facts about the organization, and fetching them per row
      // would let two subjects of the same tenant disagree mid-sweep.
      const organizations = new Map<string, { currency: string; timezone: string }>();
      for (const organizationId of new Set(rows.map((row) => row.organization_id))) {
        const { data: found } = await persistence
          .from("organizations")
          .select("base_currency, default_timezone")
          .eq("id", organizationId);
        const [organization] = found ?? [];
        if (
          typeof organization?.base_currency === "string" &&
          typeof organization?.default_timezone === "string"
        ) {
          organizations.set(organizationId, {
            currency: organization.base_currency,
            timezone: organization.default_timezone,
          });
        }
      }

      return rows.flatMap((row) => {
        const organization = organizations.get(row.organization_id);
        // An organization whose currency or timezone cannot be read is skipped
        // rather than defaulted. A guessed currency would turn a spend figure
        // into a different number in the ledger.
        if (!organization) return [];
        return [
          {
            organizationId: row.organization_id,
            campaignId: row.campaign_id,
            subject: { kind: "campaign_action" as const, actionRunId: row.action_run_id },
            // The exposure does not record which channel published it, and
            // inventing one would attribute a figure to a channel nobody chose.
            channel: null,
            currency: organization.currency,
            timezone: organization.timezone,
            providerReference: row.external_reference,
            since: isoDate(row.published_at),
            until: isoDate(at),
          },
        ];
      });
    },
  };
}

/**
 * The insights reader for a deployment with no Meta connection.
 *
 * It reports a failure rather than throwing, because a sweep that dies on its
 * first subject tells an operator less than one that finishes and says why
 * every subject was unreadable. `retryable: false` is the honest value: no
 * amount of retrying connects an account.
 *
 * In practice the grant check refuses first -- no organization can hold
 * `read_meta_metrics` without a connection to grant it against -- so this is
 * the second of two fences rather than the only one. It exists because "the
 * grant check will surely catch it" is how the first fence gets removed later.
 */
export function createUnavailableInsightsReader(): MetaInsightsReader {
  return {
    async readAdInsights() {
      return { outcome: "failed", failureCode: "meta.connection_absent", retryable: false };
    },
  };
}
