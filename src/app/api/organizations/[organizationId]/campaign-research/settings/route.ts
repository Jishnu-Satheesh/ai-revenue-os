import { NextResponse } from "next/server";

import type { OrganizationRole } from "@/domain/organizations/types";
import {
  hasOrganizationPermission,
  organizationRolePermissions,
} from "@/domain/access/permissions";
import { researchPolicyInputSchema } from "@/domain/campaigns/research-policy";
import { apiErrorResponse, getOrganizationContext } from "@/lib/api/organization-context";
import { DomainError } from "@/lib/errors";
import {
  createResearchPolicyRepository,
  isResearchPersistenceFailure,
  type ResearchPersistence,
} from "@/modules/campaigns/infrastructure/research-policy-repository";

/**
 * The spending policy that decides whether campaign research may run at all.
 *
 * Task 6 built the whole research machine against a policy nothing could
 * create, so none of it was reachable. This is the surface that sets one.
 *
 * Reading and writing take the same permission — `campaign.research_request` —
 * because whoever may spend the allowance is whoever may set it. Splitting them
 * would let someone raise a ceiling they are not trusted to spend against. The
 * database checks the same permission again inside both functions, so this
 * route is a courtesy to the client rather than the fence itself.
 */

const researchManagerRoles = (
  Object.keys(organizationRolePermissions) as OrganizationRole[]
).filter((role) => hasOrganizationPermission(role, "campaign.research_request"));

function repositoryFor(context: Awaited<ReturnType<typeof getOrganizationContext>>) {
  return createResearchPolicyRepository(
    context.supabase as unknown as ResearchPersistence,
  );
}

/**
 * The research tables are closed to members, so a refusal from the database
 * arrives as a typed failure rather than a row. Mapped by name here; anything
 * unrecognised stays unavailable rather than becoming a guessed business
 * outcome.
 */
function researchErrorResponse(error: unknown) {
  if (!isResearchPersistenceFailure(error)) return apiErrorResponse(error);
  switch (error.kind) {
    case "forbidden":
      return apiErrorResponse(
        new DomainError("AUTHORIZATION_ERROR", "You may not configure campaign research."),
      );
    case "invalid":
      return apiErrorResponse(
        new DomainError("VALIDATION_ERROR", "That research policy is not valid."),
      );
    case "not_found":
      // Not an error worth dressing up: an organization that has never set a
      // policy simply has none, and the surface says so.
      return apiErrorResponse(
        new DomainError("FEATURE_NOT_AVAILABLE", "No research policy is set."),
      );
    default:
      return apiErrorResponse(
        new DomainError("INTEGRATION_ERROR", "The research policy could not be read just now."),
      );
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const context = await getOrganizationContext(params, researchManagerRoles);
    // The ledger rather than the policy alone: what is already reserved and
    // when the last run was admitted are what make a budget mean anything.
    return NextResponse.json(
      await repositoryFor(context).readLedger({ organizationId: context.organizationId }),
      { status: 200 },
    );
  } catch (error) {
    return researchErrorResponse(error);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const context = await getOrganizationContext(params, researchManagerRoles);
    const policy = researchPolicyInputSchema.parse(
      await request.json().catch(() => {
        throw new DomainError("VALIDATION_ERROR", "The request body is not valid JSON.");
      }),
    );

    // A new version every time. Editing one in place would retroactively
    // rewrite what earlier spending was allowed to be, because every run
    // records the version that admitted it.
    const saved = await repositoryFor(context).savePolicy({
      organizationId: context.organizationId,
      policy,
    });

    return NextResponse.json(saved, { status: 200 });
  } catch (error) {
    return researchErrorResponse(error);
  }
}
