import type { SupabaseClient } from "@supabase/supabase-js";

import { hasOrganizationPermission } from "@/domain/access/permissions";
import type { OrganizationRole } from "@/domain/organizations/types";
import { logger } from "@/lib/logger";
import type { Database } from "@/lib/supabase/database.types";
import { isCampaignsEnabled } from "@/modules/campaigns/application/feature-access";
import type {
  AssetHomeRecord,
  CampaignHomeReads,
  CampaignHomeRecord,
  PrivatePreviewImage,
} from "@/modules/campaigns/application/home-preview-types";
import { readHomeCampaigns } from "@/modules/campaigns/infrastructure/home-campaign-reader";
import {
  readHomeLogo,
  readHomePosterAssets,
  readHomeReferenceAssets,
} from "@/modules/campaigns/infrastructure/home-asset-reader";
import type { HomeAssetPersistence } from "@/modules/campaigns/infrastructure/home-asset-reader";
import type { HomeCampaignPersistence } from "@/modules/campaigns/infrastructure/home-campaign-reader";
import type { HomePreviewStorage } from "@/modules/campaigns/infrastructure/home-preview-storage";
import { createCampaignReadRepository } from "@/modules/campaigns/infrastructure/repository";
import type { CampaignPersistence } from "@/modules/campaigns/infrastructure/repository";
import { hasGrowthIntelligenceAccess } from "@/modules/growth-intelligence/application/feature-access";
import { createAuthenticatedGrowthIntelligenceReadRepository } from "@/modules/growth-intelligence/infrastructure/read-repository";
import { createAuthenticatedChannelAnalysisRepository } from "@/modules/analysis/infrastructure/read-repository";
import { createCampaignProposalReader } from "@/modules/campaigns/infrastructure/proposal-read-repository";
import type { ProposalReadPersistence } from "@/modules/campaigns/infrastructure/proposal-read-repository";
import { isOverviewGrowthProgressEnabled } from "@/modules/organizations/application/growth-progress-access";
import { loadGrowthProgress } from "@/modules/organizations/application/growth-progress-service";
import {
  disabledGrowthProgressSection,
  failedGrowthProgressSection,
  type GrowthProgressSection,
} from "@/modules/organizations/application/growth-progress-view";
import { createGrowthAdviceReader } from "@/modules/organizations/infrastructure/growth-advice-reader";
import { createGrowthProgressRepository } from "@/modules/organizations/infrastructure/growth-progress-repository";
import { filterRevenueInputForViewer } from "@/modules/organizations/infrastructure/revenue-inputs";
import { readLatestRevenueSnapshot } from "@/modules/organizations/infrastructure/revenue-snapshot-repository";
import {
  readRevenueSource,
  revenueDayInZone,
} from "@/modules/organizations/infrastructure/revenue-source";
import type { HomeRevenueSource } from "@/modules/organizations/application/home-types";
import { isIntegrationHubEnabled } from "@/modules/integrations/application/feature-access";
import { buildOrganizationHomeView } from "@/modules/organizations/application/home-service";
import type { OrganizationHomeView } from "@/modules/organizations/application/home-types";
import type { DigitalTwinSnapshot } from "@/modules/organizations/infrastructure/repository";

/**
 * Session-bound orchestration for the organization home.
 *
 * The route already resolved membership and loaded the required Digital Twin
 * snapshot; this loader receives both and never refetches or redesigns them.
 * Every campaign-side read reuses the passed session client, so RLS stays the
 * boundary throughout. No new client is created, no env credential is read,
 * and no service-role import belongs here.
 *
 * Gate decisions are made before any work is scheduled: a disabled or
 * unauthorized source gets its disabled envelope up front and its reader never
 * runs — not through the front door and not through another reader's cover
 * path. Allowed sources run independently and settle before composition.
 *
 * Failure logs use `organization_home.section_read_failed` with a fixed safe
 * code per source. Per-image trouble inside the readers keeps its existing
 * `organization_home.preview_failed` event from Tasks 2/3; this loader does
 * not re-emit it. Both are diagnostic logs only, never audit events or
 * notification triggers, and never carry a raw message, path, row, URL, or
 * payload.
 */
export type LoadOrganizationHomeInput = {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  role: OrganizationRole;
  /** Signed-in actor, for per-viewer recommendation and insight reads. */
  actorId: string;
  snapshot: DigitalTwinSnapshot;
  correlationId: string;
  now: string;
};

type HomeSource = "campaigns" | "posters" | "references" | "logo" | "revenue" | "growth";

function logSectionFailure(input: {
  organizationId: string;
  correlationId: string;
  source: HomeSource;
  elapsedMs: number;
}): void {
  logger.error("organization_home.section_read_failed", {
    organizationId: input.organizationId,
    correlationId: input.correlationId,
    errorCode: `${input.source}:home_read_failed`,
    durationMs: input.elapsedMs,
  });
}

export async function loadOrganizationHome(
  input: LoadOrganizationHomeInput,
): Promise<OrganizationHomeView> {
  const { supabase, organizationId, role, actorId, snapshot, correlationId, now } = input;

  const campaignsGate = isCampaignsEnabled(organizationId);
  const growthGate = hasGrowthIntelligenceAccess(organizationId, "market");
  const integrationsGate = isIntegrationHubEnabled(organizationId);
  const gates = {
    campaigns: campaignsGate,
    growth: growthGate,
    integrations: integrationsGate,
  };
  // Rollout flag guards home loading AND publication (D08). Server-derived
  // from the environment on every load — never a browser assertion. Flag ON
  // runs the fixed-projection path and bypasses the legacy revenue
  // read/recalculation entirely; flag OFF preserves legacy behavior exactly.
  const growthEnabled = isOverviewGrowthProgressEnabled(organizationId);

  const canReadCampaigns = campaignsGate && hasOrganizationPermission(role, "campaign.read");
  const canReadArtwork = hasOrganizationPermission(role, "asset.read");
  const canReadReferences = campaignsGate && hasOrganizationPermission(role, "asset.read");
  const canReadLogo = canReadReferences;
  const canReadPosters =
    campaignsGate &&
    hasOrganizationPermission(role, "asset.read") &&
    hasOrganizationPermission(role, "campaign.read");

  // Adapters over the SAME session client. The casts keep the exact object
  // reference: `database` is the passed supabase, and `storage.storage` is the
  // passed supabase.storage. No query or signature happens here; the readers
  // own their ports.
  const database = supabase as unknown as HomeCampaignPersistence & HomeAssetPersistence;
  const storage: HomePreviewStorage = {
    storage: supabase.storage as HomePreviewStorage["storage"],
  };
  const repository = createCampaignReadRepository(supabase as unknown as CampaignPersistence);
  const read = {
    getCampaign: repository.getCampaign.bind(repository),
    getVersion: repository.getVersion.bind(repository),
    latestGenerationRun: repository.latestGenerationRun.bind(repository),
  };

  // Disabled envelopes first. A gated source never schedules work below.
  let campaignsSource: CampaignHomeReads["campaigns"] = { status: "disabled" };
  let postersSource: CampaignHomeReads["posters"] = { status: "disabled" };
  let referencesSource: CampaignHomeReads["references"] = { status: "disabled" };
  let logo: PrivatePreviewImage | null = null;
  const campaignsScheduled = canReadCampaigns;
  const postersScheduled = canReadPosters;
  const referencesScheduled = canReadReferences;
  const logoScheduled = canReadLogo;

  // Revenue-scenario reads run through the shared revenue source so the
  // home and the proposal route reason over the same inputs. Bands need
  // channel.read; each action kind needs its own module gate and permission.
  const canReadRevenueBands = hasOrganizationPermission(role, "channel.read");
  const canReadRevenueActions =
    growthGate && hasOrganizationPermission(role, "growth_intelligence.read");
  const canReadRevenueProposals = campaignsGate && hasOrganizationPermission(role, "campaign.read");

  const startedAt = Date.now();
  // The nightly snapshot answers first when one validates: the page reads
  // instead of analyzing. A read failure here is not a section failure —
  // the live path below is the fallback, and only its failure degrades.
  // Behind the growth flag this whole legacy path is bypassed, so the
  // snapshot row is never even fetched.
  const snapshotPromise =
    !growthEnabled && canReadRevenueBands
      ? readLatestRevenueSnapshot(supabase, organizationId).catch(() => null)
      : Promise.resolve(null);
  const scheduled: { source: HomeSource; run: Promise<unknown> }[] = [];
  if (campaignsScheduled) {
    scheduled.push({
      source: "campaigns",
      run: readHomeCampaigns({
        database,
        read,
        storage,
        organizationId,
        now,
        correlationId,
        canReadArtwork,
      }),
    });
  }
  if (postersScheduled) {
    scheduled.push({
      source: "posters",
      run: readHomePosterAssets({
        database,
        storage,
        organizationId,
        now,
        correlationId,
      }),
    });
  }
  if (referencesScheduled) {
    scheduled.push({
      source: "references",
      run: readHomeReferenceAssets({
        database,
        storage,
        organizationId,
        now,
        correlationId,
      }),
    });
  }
  if (logoScheduled) {
    scheduled.push({
      source: "logo",
      run: readHomeLogo({ database, storage, organizationId, now, correlationId }),
    });
  }

  const [settled, stored] = await Promise.all([
    Promise.allSettled(scheduled.map((task) => task.run)),
    snapshotPromise,
  ]);
  const elapsedMs = Date.now() - startedAt;

  // Stored snapshot first, narrowed to this viewer; live reads only when no
  // snapshot validates. Either way the composer builds the same scenario.
  let revenueSource: HomeRevenueSource;
  if (growthEnabled) {
    revenueSource = { status: "disabled" };
  } else if (!canReadRevenueBands) {
    revenueSource = { status: "disabled" };
  } else if (stored !== null && stored.state === "ready") {
    const revenueDay = revenueDayInZone(snapshot.organization.default_timezone, now);
    revenueSource = {
      status: "ready",
      input: filterRevenueInputForViewer(stored.input, {
        includeProposals: canReadRevenueProposals,
        includeActions: canReadRevenueActions,
      }),
      fetchedAt: now,
      extraNotes: [
        ...(stored.aiNote ? [stored.aiNote] : []),
        ...(stored.snapshotDate < revenueDay
          ? [`Snapshot from ${stored.snapshotDate}; the nightly refresh has not landed yet.`]
          : []),
      ],
    };
  } else {
    revenueSource = await readRevenueSource({
      reads: {
        analysis: createAuthenticatedChannelAnalysisRepository(supabase),
        growthReads: createAuthenticatedGrowthIntelligenceReadRepository(supabase),
        proposalReader: createCampaignProposalReader(
          supabase as unknown as ProposalReadPersistence,
        ),
      },
      organizationId,
      actorId,
      timeZone: snapshot.organization.default_timezone,
      now,
      canBands: canReadRevenueBands,
      canActions: canReadRevenueActions,
      canProposals: canReadRevenueProposals,
      onFailure: () => {
        logSectionFailure({
          organizationId,
          correlationId,
          source: "revenue",
          elapsedMs: Date.now() - startedAt,
        });
      },
    });
  }

  for (let index = 0; index < scheduled.length; index += 1) {
    const task = scheduled[index] as { source: HomeSource; run: Promise<unknown> };
    const outcome = settled[index] as PromiseSettledResult<unknown>;
    if (outcome.status === "fulfilled") {
      if (task.source === "campaigns") {
        campaignsSource = {
          status: "ready",
          data: outcome.value as readonly CampaignHomeRecord[],
          fetchedAt: now,
        };
      } else if (task.source === "posters") {
        postersSource = {
          status: "ready",
          data: outcome.value as readonly AssetHomeRecord[],
          fetchedAt: now,
        };
      } else if (task.source === "references") {
        referencesSource = {
          status: "ready",
          data: outcome.value as readonly AssetHomeRecord[],
          fetchedAt: now,
        };
      } else {
        logo = outcome.value as PrivatePreviewImage | null;
      }
    } else {
      // Any rejection — DomainError or otherwise — becomes a safe envelope.
      // The raw reason never reaches the log or the DTO; only the fixed code.
      logSectionFailure({
        organizationId,
        correlationId,
        source: task.source,
        elapsedMs,
      });
      if (task.source === "campaigns") {
        campaignsSource = { status: "failed", code: "HOME_READ_FAILED" };
      } else if (task.source === "posters") {
        postersSource = { status: "failed", code: "HOME_READ_FAILED" };
      } else if (task.source === "references") {
        referencesSource = { status: "failed", code: "HOME_READ_FAILED" };
      } else {
        logo = null;
      }
    }
  }

  // Fixed-projection growth section. Flag OFF keeps the disabled shape so
  // rollback is the flag alone. Flag ON composes through the growth
  // service on the member session; a transport throw degrades the section
  // with a safe code, never the lower home.
  let growthProgress: GrowthProgressSection;
  if (!growthEnabled) {
    growthProgress = disabledGrowthProgressSection();
  } else {
    const growthStartedAt = Date.now();
    try {
      growthProgress = await loadGrowthProgress(
        {
          organizationId,
          actorId,
          nowIso: now,
          timeZone: snapshot.organization.default_timezone,
          permissions: {
            canReadProjections: hasOrganizationPermission(role, "channel.read"),
            canReadGrowth:
              growthGate && hasOrganizationPermission(role, "growth_intelligence.read"),
            canReadCampaigns: campaignsGate && hasOrganizationPermission(role, "campaign.read"),
          },
        },
        {
          progressReads: createGrowthProgressRepository(supabase),
          readAdvice: (adviceInput) =>
            createGrowthAdviceReader({
              growthReads: createAuthenticatedGrowthIntelligenceReadRepository(supabase),
              proposalReader: createCampaignProposalReader(
                supabase as unknown as ProposalReadPersistence,
              ),
            }).readCandidates(adviceInput),
        },
      );
    } catch {
      growthProgress = failedGrowthProgressSection("SOURCE_READ_FAILED");
      logSectionFailure({
        organizationId,
        correlationId,
        source: "growth",
        elapsedMs: Date.now() - growthStartedAt,
      });
    }
  }

  // Role passes straight through: create/edit/review wording stays Task 1's
  // rules inside the composer. This loader never recomputes CTAs.
  return buildOrganizationHomeView({
    snapshot,
    role,
    organizationId,
    now,
    revenue: revenueSource,
    growthProgress,
    sources: {
      campaigns: campaignsSource,
      posters: postersSource,
      references: referencesSource,
      logo,
    },
    gates,
  });
}
