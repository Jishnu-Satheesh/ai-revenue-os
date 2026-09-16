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
  runRevenueSnapshotBuild,
  selectDueSnapshotOrgs,
} from "@/modules/organizations/application/revenue-snapshot";
import {
  createRevenueProposalProvider,
  REVENUE_PROPOSAL_MAX_ACTIONS,
} from "@/modules/organizations/infrastructure/revenue-proposal-provider";
import { readRevenueSource } from "@/modules/organizations/infrastructure/revenue-source";
import {
  trimRevenueSnapshots,
  writeRevenueSnapshot,
} from "@/modules/organizations/infrastructure/revenue-snapshot-repository";
import { createRevenueWorkerServiceClient } from "@/lib/supabase/service";

/**
 * Nightly revenue snapshots (ADR 0060): one stored answer per organization
 * per local day behind the home growth outlook, so the page reads instead of
 * analyzing. An hourly dispatcher fans out only organizations inside their
 * local midnight hour; each build is idempotent per org-day and leaves the
 * last good row alone on any failure.
 */

const retry = {
  maxAttempts: 3,
  minTimeoutInMs: 1_000,
  maxTimeoutInMs: 30_000,
  factor: 2,
} as const;

const DISPATCH_ORG_SCAN_LIMIT = 500;

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
    const { due, skipped } = selectDueSnapshotOrgs(
      (data ?? []).map((row) => ({
        organizationId: row.id,
        timeZone: row.default_timezone,
      })),
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
    const result = await runRevenueSnapshotBuild(
      {
        organizationId: parsed.organizationId,
        snapshotDate: parsed.snapshotDate,
        timeZone: parsed.timeZone,
        nowIso: new Date().toISOString(),
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
    return result;
  },
});
