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
import { createSessionSubjectPackPort } from "@/modules/memory";

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

/**
 * Subject drafting reads the shared subject_drafting context, not an ad hoc
 * assist query. A person names and confirms the subject; person-entered names
 * win and the drafter never invents offers or prices. The pack is pinned
 * under the actor's own session: the prepare call binds actor, purpose, and
 * tenant before any model sees a summary.
 */
function productionServiceFor(context: SubjectRouteContext) {
  const supabase = context.supabase as SupabaseClient<Database>;

  return createSubjectService({
    store: createSubjectRepository(context.supabase as SubjectPersistence),
    subjectPack: createSessionSubjectPackPort(supabase),
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
