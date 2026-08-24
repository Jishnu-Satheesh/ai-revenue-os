import { RegisterRouteLabel } from "@/components/layout/route-context";
import { ChannelsManagement } from "@/components/channels/channels-management";
import { hasOrganizationPermission } from "@/domain/access/permissions";
import { getOrganization } from "@/domain/organizations/repository";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { createChannelService } from "@/modules/channels/application/service";
import { createAuthenticatedChannelRepository } from "@/modules/channels/infrastructure/repository";
import { isGovernedChannelAnalysisEnabled } from "@/modules/integrations/application/feature-access";

export default async function ChannelsPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
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

  return (
    <>
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
        workspaceEnabled={isGovernedChannelAnalysisEnabled(context.organizationId)}
      />
    </>
  );
}
