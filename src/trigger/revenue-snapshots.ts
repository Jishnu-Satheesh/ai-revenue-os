import { randomUUID } from "node:crypto";

import { logger, schedules, schemaTask, tasks } from "@trigger.dev/sdk";
import { z } from "zod";

import { createAuthenticatedChannelAnalysisRepository } from "@/modules/analysis/infrastructure/read-repository";
import { isCampaignsEnabled } from "@/modules/campaigns/application/feature-access";
import { createCampaignProposalReader } from "@/modules/campaigns/infrastructure/proposal-read-repository";
import type { ProposalReadPersistence } from "@/modules/campaigns/infrastructure/proposal-read-repository";
import { hasGrowthIntelligenceAccess } from "@/modules/growth-intelligence/application/feature-access";
import { createAuthenticatedGrowthIntelligenceReadRepository } from "@/modules/growth-intelligence/infrastructure/read-repository";
import {
  isOverviewGrowthProgressEnabled,
  parseOverviewGrowthProgressOrganizationIds,
} from "@/modules/organizations/application/growth-progress-access";
import { assembleLedgerBaselineCandidate } from "@/modules/organizations/application/growth-candidate-assembly";
import { publishDueGrowthProjections } from "@/modules/organizations/application/growth-projection-publisher";import {
  mergeSnapshotDispatchCandidates,
  runRevenueSnapshotBuild,
  selectDueSnapshotOrgs,
  throwIfSnapshotBuildFailed,
  toSnapshotBuildOutput,
} from "@/modules/organizations/application/revenue-snapshot";
import {
  createGrowthProjectionRepository,
  createGrowthScheduleRepository,
} from "@/modules/organizations/infrastructure/growth-projection-repository";
import {
  createGrowthProgressRepository,
  listBaselineCoordinates,
  resolveGrowthRevenueDefinitionId,
} from "@/modules/organizations/infrastructure/growth-progress-repository";
import {
  createRevenueProposalProvider,
  REVENUE_PROPOSAL_MAX_ACTIONS,
} from "@/modules/organizations/infrastructure/revenue-proposal-provider";
import { readRevenueSource } from "@/modules/organizations/infrastructure/revenue-source";
import {
  trimRevenueSnapshots,
  writeRevenueSnapshot,
} from "@/modules/organizations/infrastructure/revenue-snapshot-repository";
import { env } from "@/lib/env";
import { createRevenueWorkerServiceClient } from "@/lib/supabase/service";

/**
 * Nightly revenue snapshots (ADR 0060): one stored answer per organization
 * per local day behind the home growth outlook, so the page reads instead of
 * analyzing. An hourly dispatcher fans out only organizations inside their
 * local midnight hour; each build is idempotent per org-day and leaves the
 * last good row alone on any failure.
 *
 * The same idempotent org-day run carries a second, separately reported
 * phase: prospective growth-projection publication for allowlisted
 * organizations. It reuses the snapshot's validated material without a new
 * model call, and its failure is reported beside — never hidden behind —
 * the snapshot outcome.
 */

const retry = {
  maxAttempts: 3,
  minTimeoutInMs: 1_000,
  maxTimeoutInMs: 30_000,
  factor: 2,
} as const;

const DISPATCH_ORG_SCAN_LIMIT = 500;

/**
 * Allowlisted growth-publication organizations outside the capped legacy
 * scan, resolved to their dispatch rows. A misconfigured allowlist — or an
 * unreadable organizations table — must never break the nightly snapshots,
 * so every failure here degrades to the legacy scan alone with one warning.
 */
async function readGrowthAllowlistOrgs(
  supabase: ReturnType<typeof createRevenueWorkerServiceClient>,
  scannedIds: ReadonlySet<string>,
): Promise<{ organizationId: string; timeZone: string }[]> {
  let allowlist: Set<string>;
  try {
    allowlist = parseOverviewGrowthProgressOrganizationIds(
      env.OVERVIEW_GROWTH_PROGRESS_ORGANIZATION_IDS,
    );
  } catch {
    logger.warn("revenue.growth_allowlist_unavailable", { reason: "invalid-config" });
    return [];
  }
  const extras = [...allowlist].filter((organizationId) => !scannedIds.has(organizationId));
  if (extras.length === 0) return [];
  const { data, error } = await supabase
    .from("organizations")
    .select("id,default_timezone")
    .eq("status", "active")
    .in("id", extras);
  if (error || !data) {
    logger.warn("revenue.growth_allowlist_unavailable", { reason: "read-failed" });
    return [];
  }
  return data.map((row) => ({ organizationId: row.id, timeZone: row.default_timezone }));
}

const snapshotOrgPayloadSchema = z.strictObject({
  organizationId: z.string().uuid(),
  snapshotDate: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/),
  timeZone: z.string().trim().min(1).max(80),
  gates: z.strictObject({ growth: z.boolean(), campaigns: z.boolean() }),
  correlationId: z.string().uuid(),
});

export const revenueSnapshotsDispatchTask = schedules.task({
  id: "revenue-snapshots.dispatch",
  cron: "0 * * * *",
  retry,
  maxDuration: 300,
  run: async () => {
    const supabase = createRevenueWorkerServiceClient();
    const now = new Date();
    const { data, error } = await supabase
      .from("organizations")
      .select("id,default_timezone")
      .eq("status", "active")
      .order("id", { ascending: true })
      .limit(DISPATCH_ORG_SCAN_LIMIT);
    if (error) throw new Error("Revenue snapshot dispatch organization scan failed.");
    const scanned = (data ?? []).map((row) => ({
      organizationId: row.id,
      timeZone: row.default_timezone,
    }));
    const allowlisted = await readGrowthAllowlistOrgs(
      supabase,
      new Set(scanned.map((org) => org.organizationId)),
    );
    const { due, skipped } = selectDueSnapshotOrgs(
      mergeSnapshotDispatchCandidates(scanned, allowlisted),
      now,
    );
    let triggered = 0;
    for (const org of due) {
      await tasks.trigger<typeof revenueSnapshotsBuildOrgTask>(
        "revenue-snapshots.build-org",
        {
          organizationId: org.organizationId,
          snapshotDate: org.snapshotDate,
          timeZone: org.timeZone,
          gates: {
            growth: hasGrowthIntelligenceAccess(org.organizationId, "market"),
            campaigns: isCampaignsEnabled(org.organizationId),
          },
          correlationId: randomUUID(),
        },
        { idempotencyKey: `revenue-snapshot:${org.organizationId}:${org.snapshotDate}` },
      );
      triggered += 1;
    }
    logger.info("revenue.snapshots_dispatch_scheduled", {
      due: due.length,
      triggered,
      skipped,
    });
    return { due: due.length, triggered, skipped };
  },
});

export const revenueSnapshotsBuildOrgTask = schemaTask({
  id: "revenue-snapshots.build-org",
  schema: snapshotOrgPayloadSchema,
  retry,
  maxDuration: 300,
  run: async (payload) => {
    const parsed = snapshotOrgPayloadSchema.parse(payload);
    const supabase = createRevenueWorkerServiceClient();
    const nowIso = new Date().toISOString();
    const result = await runRevenueSnapshotBuild(
      {
        organizationId: parsed.organizationId,
        snapshotDate: parsed.snapshotDate,
        timeZone: parsed.timeZone,
        nowIso,
        gates: parsed.gates,
        correlationId: parsed.correlationId,
      },
      {
        reads: {
          analysis: createAuthenticatedChannelAnalysisRepository(supabase),
          growthReads: createAuthenticatedGrowthIntelligenceReadRepository(supabase),
          proposalReader: createCampaignProposalReader(
            supabase as unknown as ProposalReadPersistence,
          ),
        },
        readSource: (sourceInput) => readRevenueSource(sourceInput),
        maxProposalActions: REVENUE_PROPOSAL_MAX_ACTIONS,
        proposeRanges: (input) => createRevenueProposalProvider().propose(input),
        writeSnapshot: (snapshot) => writeRevenueSnapshot(supabase, snapshot),
        trimSnapshots: (organizationId, keepSinceDate) =>
          trimRevenueSnapshots(supabase, organizationId, keepSinceDate),
        onFailure: ({ organizationId, correlationId }) => {
          logger.warn("revenue.snapshot_build_failed", { organizationId, correlationId });
        },
      },
    );
    // Prospective publication rides the same idempotent org-day run: the
    // transport key on the dispatch trigger already dedupes redeliveries,
    // and the publication RPC replays stored identities, so a retried run
    // can neither move the frozen line nor duplicate its audit event. A
    // publication failure is reported beside the snapshot outcome — the run
    // never claims stored:true as proof the freeze succeeded.
    const growthPublication = await publishDueGrowthProjections(
      {
        organizationId: parsed.organizationId,
        nowIso,
        timeZone: parsed.timeZone,
        correlationId: parsed.correlationId,
        candidateMaterial: result.candidateMaterial,
      },
      {
        isEnabled: (organizationId) => isOverviewGrowthProgressEnabled(organizationId),
        // Schedule discovery runs through the narrow origins RPC on the
        // service client (Task-5 decision b): direct projection-table SELECT
        // is revoked for service_role, so the session read port would fail
        // closed here on every run. A throwing schedule read stays a
        // fail-closed skip with its reason intact, never a blind publish.
        readSchedule: async (organizationId, asOfDate) => {
          try {
            return await createGrowthScheduleRepository(supabase).readSchedule({
              organizationId,
              asOfDate,
            });
          } catch {
            return { status: "unavailable", reasonCode: "SCHEDULE_READ_FAILED" as const };
          }
        },
        buildCandidate: (material, context) =>
          assembleLedgerBaselineCandidate(material, context, {
            resolveRevenueDefinitionId: (organizationId) =>
              resolveGrowthRevenueDefinitionId(supabase, organizationId),
            listBaselineCoordinates: (coordinateInput) =>
              listBaselineCoordinates(supabase, coordinateInput),
            readBaselineFacts: (factInput) =>
              createGrowthProgressRepository(supabase).readRevenueFacts(factInput),
          }),
        publish: (publishInput) => createGrowthProjectionRepository(supabase).publish(publishInput),
      },
    );
    if (growthPublication.results.some((entry) => entry.status === "failed")) {
      logger.warn("revenue.growth_projection_publish_failed", {
        organizationId: parsed.organizationId,
        correlationId: parsed.correlationId,
      });
    }
    // The validated union input stays in memory: the run output Trigger
    // persists carries only counts, reasons and the publication summary —
    // never history amounts, actions or assumptions. A failed primary job or
    // an errored horizon fails the run red (bounded retries apply) instead
    // of completing green-with-skips; honest skips stay green with reasons.
    const output = toSnapshotBuildOutput(result, growthPublication);
    throwIfSnapshotBuildFailed(output, parsed.organizationId);
    return output;
  },
});
