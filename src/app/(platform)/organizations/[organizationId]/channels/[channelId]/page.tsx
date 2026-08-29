import { notFound } from "next/navigation";

import { ChannelWorkspace } from "@/components/analysis/channel-workspace";
import { ChannelDetail } from "@/components/channels/channel-detail";
import { ChannelSetupPanel } from "@/components/channels/channels-management";
import { RegisterRouteLabel } from "@/components/layout/route-context";
import { hasOrganizationPermission } from "@/domain/access/permissions";
import { getOrganization } from "@/domain/organizations/repository";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { buildChannelWorkspaceView } from "@/modules/analysis/application/read-model";
import { createAuthenticatedChannelAnalysisRepository } from "@/modules/analysis/infrastructure/read-repository";
import { createChannelService } from "@/modules/channels/application/service";
import { createAuthenticatedChannelRepository } from "@/modules/channels/infrastructure/repository";
import { isGovernedChannelAnalysisEnabled } from "@/modules/integrations/application/feature-access";

/**
 * One channel, one page.
 *
 * Replaces the split between a register dialog (setup) and a separate
 * `/economics/channels/[channelId]` route (analysis). The analysis data
 * loading below -- `loadRuns`, the `displayedRun` selection,
 * `loadFindingsForRun`, `loadEvidence`, `loadRecommendationsForRun` and
 * `buildChannelWorkspaceView` -- is unchanged from that retired route; only
 * when it runs, and what it is wrapped in, is new. See
 * `docs/superpowers/specs/2026-08-28-channels-and-economics-merge-design.md`.
 */
export default async function ChannelDetailPage({
  params,
}: {
  params: Promise<{ organizationId: string; channelId: string }>;
}) {
  const { channelId } = await params;
  const context = await getOrganizationContext(params);
  const organization = await getOrganization(context.supabase, context.organizationId);
  const role = context.membership.role;

  const snapshot = await createChannelService(
    createAuthenticatedChannelRepository(context.supabase),
  ).listManagementSnapshot({
    organizationId: context.organizationId,
    actorId: context.user.id,
    role,
  });
  const channel = snapshot.channels.find((candidate) => candidate.id === channelId);
  if (!channel) notFound();

  // Two differences from the route this replaces. The analysis flag no longer
  // 404s the page, because Setup is worth reaching without it; and an archived
  // channel opens on Setup, matching today, where the workspace link is hidden
  // for archived channels.
  const analysisAvailable =
    isGovernedChannelAnalysisEnabled(context.organizationId) && channel.status === "active";

  let workspace: React.ReactNode | null = null;
  if (analysisAvailable) {
    const analysis = createAuthenticatedChannelAnalysisRepository(context.supabase);
    const [runs, evidenceWindows] = await Promise.all([
      analysis.loadRuns({ organizationId: context.organizationId, channelId, limit: 10 }),
      analysis.loadEvidenceWindows({
        organizationId: context.organizationId,
        channelId,
        limit: 24,
      }),
    ]);

    // Findings are read for the one run the page is about to display, so every
    // figure on the page was computed for the window the page names. Reading them
    // by channel returns every run's answers at once, and the newest run's window
    // then sits above another run's numbers.
    const displayedRun = runs.find((run) => run.status === "completed") ?? null;
    const findings = displayedRun
      ? await analysis.loadFindingsForRun({
          organizationId: context.organizationId,
          analysisRunId: displayedRun.id,
        })
      : [];
    // Both reads hang off the displayed run alone, so the page never pairs one
    // window's figures with another window's narration.
    const [evidence, recommendations] = await Promise.all([
      analysis.loadEvidence({
        organizationId: context.organizationId,
        findingIds: findings.map((finding) => finding.id),
      }),
      displayedRun
        ? analysis.loadRecommendationsForRun({
            organizationId: context.organizationId,
            analysisRunId: displayedRun.id,
            viewerId: context.user.id,
          })
        : Promise.resolve([]),
    ]);

    const view = buildChannelWorkspaceView({ runs, findings, evidence, recommendations });

    workspace = (
      <ChannelWorkspace
        organizationId={context.organizationId}
        channel={{
          id: channel.id,
          key: channel.key,
          displayName: channel.display_name,
          category: channel.category,
          templateKey: channel.template_key,
          status: channel.status,
        }}
        view={view}
        // The windows this channel actually holds governed evidence for. A
        // window counted back from today reaches an uploaded report only by
        // coincidence, because reports arrive covering periods already past.
        evidenceWindows={evidenceWindows}
        canRunAnalysis={hasOrganizationPermission(role, "channel.manage")}
        channelsHref={`/organizations/${context.organizationId}/channels`}
        economicsHref={`/organizations/${context.organizationId}/channels`}
      />
    );
  }

  return (
    <>
      <RegisterRouteLabel segment={context.organizationId} label={organization.name} />
      <RegisterRouteLabel segment={channelId} label={channel.display_name} />
      <ChannelDetail
        channelName={channel.display_name}
        workspace={workspace}
        defaultTab={analysisAvailable ? "analysis" : "setup"}
        setup={
          <ChannelSetupPanel
            organizationId={context.organizationId}
            channel={channel}
            branches={snapshot.branches}
            branchMappings={snapshot.branchMappings}
            aliases={snapshot.aliases}
            canManage={hasOrganizationPermission(role, "channel.manage")}
            canMapBranches={hasOrganizationPermission(role, "channel.map_branch")}
          />
        }
      />
    </>
  );
}
