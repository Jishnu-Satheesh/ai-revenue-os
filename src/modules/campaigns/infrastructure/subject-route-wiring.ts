import type { SupabaseClient } from "@supabase/supabase-js";

import {
  hasOrganizationPermission,
  organizationRolePermissions,
} from "@/domain/access/permissions";
import type { OrganizationRole } from "@/domain/organizations/types";
import { getOrganizationContext } from "@/lib/api/organization-context";
import type { Database } from "@/lib/supabase/database.types";
import {
  createSubjectRouteHandlers,
  type SubjectRouteContext,
  type SubjectRouteHandlerDependencies,
} from "@/modules/campaigns/application/subject-route-handlers";
import { createSubjectService } from "@/modules/campaigns/application/subject-service";
import { assertCampaignsEnabled } from "@/modules/campaigns/application/feature-access";
import { createSubjectDescriptionDrafter } from "@/modules/campaigns/infrastructure/subject-description-drafter";
import {
  createSubjectRepository,
  type SubjectPersistence,
} from "@/modules/campaigns/infrastructure/subject-repository";
import { createMemoryWorkspaceApi } from "@/modules/memory/application/api";

type SubjectPermission = Parameters<SubjectRouteHandlerDependencies["context"]>[1];
type SubjectRouteParams = Parameters<SubjectRouteHandlerDependencies["context"]>[0];

function rolesWithSubjectPermission(permission: SubjectPermission): OrganizationRole[] {
  return (Object.keys(organizationRolePermissions) as OrganizationRole[]).filter((role) =>
    hasOrganizationPermission(role, permission),
  );
}

async function productionContext(
  params: SubjectRouteParams,
  permission: SubjectPermission,
): Promise<SubjectRouteContext> {
  const context = await getOrganizationContext(params, rolesWithSubjectPermission(permission));
  assertCampaignsEnabled(context.organizationId);
  return context;
}

function productionServiceFor(context: SubjectRouteContext) {
  const supabase = context.supabase as SupabaseClient<Database>;
  const memory = createMemoryWorkspaceApi({
    supabase,
    actor: { userId: context.user.id, role: context.membership.role },
  }).retrieval;

  return createSubjectService({
    store: createSubjectRepository(context.supabase as SubjectPersistence),
    memory,
    // Keep ordinary reads and manual writes independent of model configuration.
    drafter: {
      draft(input) {
        return createSubjectDescriptionDrafter().draft(input);
      },
    },
  });
}

export const subjectRouteHandlers = createSubjectRouteHandlers({
  context: productionContext,
  serviceFor: productionServiceFor,
});
