import { RegisterRouteLabel } from "@/components/layout/route-context";
import { ChannelsManagement } from "@/components/channels/channels-management";
import type { ChannelsLandingAnalysis } from "@/components/channels/channels-presentation";
import { parseChannelsWindow } from "@/components/channels/channels-presentation";
import { hasOrganizationPermission } from "@/domain/access/permissions";
import { getOrganization } from "@/domain/organizations/repository";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { logger } from "@/lib/logger";
import {
  buildChannelsOverviewView,
  buildOverviewWindows,
  resolveDefaultWindow,
} from "@/modules/analysis/application/channels-overview";
import {
  ChannelAnalysisReadError,
  createAuthenticatedChannelAnalysisRepository,
} from "@/modules/analysis/infrastructure/read-repository";
import { createChannelService } from "@/modules/channels/application/service";
import { createAuthenticatedChannelRepository } from "@/modules/channels/infrastructure/repository";
import { isGovernedChannelAnalysisEnabled } from "@/modules/integrations/application/feature-access";

/**
 * Keep the diagnostic log free of tenant text. Postgres codes (`42501`) and
 * the repository's own bounded codes (`VALUE_NOT_EXACT`) pass through;
 * anything else is cardinality, not information, so it becomes `unknown`.
 */
function toSafeReadCode(code: string): string {
  return /^[A-Za-z0-9_]{1,64}$/.test(code) ? code : "unknown";
}

export default async function ChannelsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ window?: string }>;
}) {
  const context = await getOrganizationContext(params);
  const organization = await getOrganization(context.supabase, context.organizationId);
  const snapshot = await createChannelService(
    createAuthenticatedChannelRepository(context.supabase),
  ).listManagementSnapshot({
    organizationId: context.organizationId,
    actorId: context.user.id,
    role: context.membership.role,
  });

  // The flag is enforced here rather than in navigation. An organization it is
  // off for does not reach the analysis reads at all, so the page degrades to
  // the register and there is nothing to pay for or to leak.
  const workspaceEnabled = isGovernedChannelAnalysisEnabled(context.organizationId);

  let analysis: ChannelsLandingAnalysis = { state: "disabled" };
  if (workspaceEnabled) {
    try {
      const repository = createAuthenticatedChannelAnalysisRepository(context.supabase);
      const [evidenceWindows, analysedKeys] = await Promise.all([
        repository.loadEvidenceWindows({
          organizationId: context.organizationId,
          channelId: null,
          limit: 24,
        }),
        repository.loadAnalysedWindowKeys({ organizationId: context.organizationId }),
      ]);

      // The page resolves which window to answer for before reading any band,
      // because a band read is scoped to one window and the read model cannot
      // infer which one it was given afterwards. The default resolver runs
      // only when the URL does not parse; a URL that parses but names no
      // declared window stays explicitly unresolved (`selectedWindow: null`)
      // so the landing suppresses figures instead of showing fallback ones.
      const requested = parseChannelsWindow((await searchParams).window);
      const declared = buildOverviewWindows(evidenceWindows);
      const selected =
        requested ?? resolveDefaultWindow({ windows: declared, analysed: analysedKeys });

      const bands = selected
        ? await repository.loadChannelBandsForWindow({
            organizationId: context.organizationId,
            windowStart: selected.windowStart,
            windowEnd: selected.windowEnd,
            grain: selected.grain,
          })
        : [];

      analysis = {
        state: "ready",
        view: buildChannelsOverviewView({
          channels: snapshot.channels,
          bands,
          evidenceWindows,
          selected,
        }),
      };
    } catch (error) {
      // Only a known analysis-read failure degrades to `unavailable` with the
      // directory intact. Authentication, tenant and unexpected failures throw
      // on to the error boundary; turning them into an empty success would
      // hide an outage behind a working-looking page.
      if (!(error instanceof ChannelAnalysisReadError)) throw error;
      logger.warn("channels_overview.read_failed", {
        organizationId: context.organizationId,
        errorCode: toSafeReadCode(error.code),
      });
      analysis = { state: "unavailable" };
    }
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-6">
      <RegisterRouteLabel segment={context.organizationId} label={organization.name} />
      <ChannelsManagement
        organizationId={context.organizationId}
        organizationName={organization.name}
        channels={snapshot.channels}
        branches={snapshot.branches}
        branchMappings={snapshot.branchMappings}
        aliases={snapshot.aliases}
        canManage={hasOrganizationPermission(context.membership.role, "channel.manage")}
        canMapBranches={hasOrganizationPermission(context.membership.role, "channel.map_branch")}
        analysis={analysis}
      />
    </div>
  );
}
