import { RegisterRouteLabel } from "@/components/layout/route-context";
import { ChannelsManagement } from "@/components/channels/channels-management";
import { ChannelsRollup } from "@/components/channels/channels-rollup";
import type { AnalysisGrain } from "@/domain/analysis/types";
import { hasOrganizationPermission } from "@/domain/access/permissions";
import { getOrganization } from "@/domain/organizations/repository";
import { getOrganizationContext } from "@/lib/api/organization-context";
import {
  buildChannelsOverviewView,
  buildOverviewWindows,
  resolveDefaultWindow,
} from "@/modules/analysis/application/channels-overview";
import { createAuthenticatedChannelAnalysisRepository } from "@/modules/analysis/infrastructure/read-repository";
import { createChannelService } from "@/modules/channels/application/service";
import { createAuthenticatedChannelRepository } from "@/modules/channels/infrastructure/repository";
import { isGovernedChannelAnalysisEnabled } from "@/modules/integrations/application/feature-access";

function isAnalysisGrain(value: string): value is AnalysisGrain {
  return value === "day" || value === "week" || value === "month";
}

/** `start..end..grain`, the one shape the window control emits. */
function parseWindow(
  value: string | undefined,
): { windowStart: string; windowEnd: string; grain: AnalysisGrain } | null {
  if (!value) return null;
  const [windowStart, windowEnd, grain] = value.split("..");
  if (!windowStart || !windowEnd || !grain) return null;
  if (!isAnalysisGrain(grain)) return null;
  return { windowStart, windowEnd, grain };
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

  let overview = null;
  if (workspaceEnabled) {
    const analysis = createAuthenticatedChannelAnalysisRepository(context.supabase);
    const [evidenceWindows, analysedKeys] = await Promise.all([
      analysis.loadEvidenceWindows({
        organizationId: context.organizationId,
        channelId: null,
        limit: 24,
      }),
      analysis.loadAnalysedWindowKeys({ organizationId: context.organizationId }),
    ]);

    // The page resolves which window to answer for before reading any band,
    // because a band read is scoped to one window and the read model cannot
    // infer which one it was given afterwards.
    const requested = parseWindow((await searchParams).window);
    const declared = buildOverviewWindows(evidenceWindows);
    const selected =
      requested ?? resolveDefaultWindow({ windows: declared, analysed: analysedKeys });

    const bands = selected
      ? await analysis.loadChannelBandsForWindow({
          organizationId: context.organizationId,
          windowStart: selected.windowStart,
          windowEnd: selected.windowEnd,
          grain: selected.grain,
        })
      : [];

    overview = buildChannelsOverviewView({
      channels: snapshot.channels,
      bands,
      evidenceWindows,
      selected,
    });
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col gap-6">
      <RegisterRouteLabel segment={context.organizationId} label={organization.name} />
      {overview ? <ChannelsRollup view={overview} organizationId={context.organizationId} /> : null}
      <ChannelsManagement
        organizationId={context.organizationId}
        organizationName={organization.name}
        channels={snapshot.channels}
        branches={snapshot.branches}
        branchMappings={snapshot.branchMappings}
        aliases={snapshot.aliases}
        canManage={hasOrganizationPermission(context.membership.role, "channel.manage")}
        canMapBranches={hasOrganizationPermission(context.membership.role, "channel.map_branch")}
        workspaceEnabled={workspaceEnabled}
      />
    </div>
  );
}
