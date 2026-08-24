import { notFound } from "next/navigation";

import { ChannelWorkspace } from "@/components/analysis/channel-workspace";
import { RegisterRouteLabel } from "@/components/layout/route-context";
import { hasOrganizationPermission } from "@/domain/access/permissions";
import { getOrganization } from "@/domain/organizations/repository";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { buildChannelWorkspaceView } from "@/modules/analysis/application/read-model";
import { createAuthenticatedChannelAnalysisRepository } from "@/modules/analysis/infrastructure/read-repository";
import { createChannelService } from "@/modules/channels/application/service";
import { createAuthenticatedChannelRepository } from "@/modules/channels/infrastructure/repository";
import { isGovernedChannelAnalysisEnabled } from "@/modules/integrations/application/feature-access";
import type { OrganizationRole } from "@/domain/organizations/types";

/**
 * The channel workspace, from the approved Superdesign draft.
 *
 * Server-rendered down to the props. Findings are an organization's own
 * financial evidence, and the read goes through the caller's session so RLS
 * decides what they may see rather than application code deciding for it.
 */
export default async function ChannelWorkspacePage({
  params,
}: {
  params: Promise<{ organizationId: string; channelId: string }>;
}) {
  const { organizationId, channelId } = await params;
  const context = await getOrganizationContext(Promise.resolve({ organizationId }));

  // Enforced here rather than in navigation. An organization the slice is off
  // for never reaches the read, so a hand-typed URL shows the same 404 as a
  // channel that does not exist.
  if (!isGovernedChannelAnalysisEnabled(context.organizationId)) notFound();

  const organization = await getOrganization(context.supabase, context.organizationId);
  const role = context.membership.role as OrganizationRole;

  const channels = await createChannelService(
    createAuthenticatedChannelRepository(context.supabase),
  ).listChannels({ organizationId: context.organizationId, actorId: context.user.id, role });
  const channel = channels.find((candidate) => candidate.id === channelId);
  if (!channel) notFound();

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
  const evidence = await analysis.loadEvidence({
    organizationId: context.organizationId,
    findingIds: findings.map((finding) => finding.id),
  });

  const view = buildChannelWorkspaceView({ runs, findings, evidence });

  return (
    <>
      <RegisterRouteLabel segment={context.organizationId} label={organization.name} />
      <RegisterRouteLabel segment={channelId} label={channel.display_name} />
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
        canRunAnalysis={hasOrganizationPermission(role, "report.retry")}
        channelsHref={`/organizations/${context.organizationId}/channels`}
        economicsHref={`/organizations/${context.organizationId}/economics`}
      />
    </>
  );
}
