import { NextResponse } from "next/server";

import type { OrganizationRole } from "@/domain/organizations/types";
import {
  hasOrganizationPermission,
  organizationRolePermissions,
} from "@/domain/access/permissions";
import { researchScheduleInputSchema } from "@/domain/campaigns/research-cadence";
import { apiErrorResponse, getOrganizationContext } from "@/lib/api/organization-context";
import { DomainError } from "@/lib/errors";
import {
  createResearchScheduleRepository,
  isResearchPersistenceFailure,
  type ResearchScheduleInput,
} from "@/modules/campaigns/infrastructure/research-schedule-repository";
import type { ResearchPersistence } from "@/modules/campaigns/infrastructure/research-policy-repository";

/**
 * The rhythm research runs on, separate from what it may spend.
 *
 * The money lives on the policy; the cadence lives here. Reading and writing
 * take the same permission that spends the allowance, because whoever may
 * spend it is whoever may set how often it is spent — and the database checks
 * that permission again inside both functions, so this route is a courtesy
 * rather than the fence. Enabling the rhythm never enables spending, which
 * stays bound to the policy's own switch.
 */

const researchManagerRoles = (
  Object.keys(organizationRolePermissions) as OrganizationRole[]
).filter((role) => hasOrganizationPermission(role, "campaign.research_request"));

function repositoryFor(context: Awaited<ReturnType<typeof getOrganizationContext>>) {
  return createResearchScheduleRepository(
    context.supabase as unknown as ResearchPersistence,
  );
}

function scheduleErrorResponse(error: unknown) {
  if (!isResearchPersistenceFailure(error)) return apiErrorResponse(error);
  switch (error.kind) {
    case "forbidden":
      return apiErrorResponse(
        new DomainError("AUTHORIZATION_ERROR", "You may not configure campaign research."),
      );
    case "invalid":
      return apiErrorResponse(
        new DomainError("VALIDATION_ERROR", "That research schedule is not valid."),
      );
    default:
      return apiErrorResponse(
        new DomainError(
          "INTEGRATION_ERROR",
          "The research schedule could not be read just now.",
        ),
      );
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const context = await getOrganizationContext(params, researchManagerRoles);
    // No row is "not scheduled", never an implied cadence: the surface
    // renders an empty schedule section rather than a 404.
    const schedule = await repositoryFor(context).readSchedule({
      organizationId: context.organizationId,
    });
    return NextResponse.json({ schedule }, { status: 200 });
  } catch (error) {
    return scheduleErrorResponse(error);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const context = await getOrganizationContext(params, researchManagerRoles);
    const schedule: ResearchScheduleInput = researchScheduleInputSchema.parse(
      await request.json().catch(() => {
        throw new DomainError("VALIDATION_ERROR", "The request body is not valid JSON.");
      }),
    );

    const saved = await repositoryFor(context).saveSchedule({
      organizationId: context.organizationId,
      schedule,
    });

    return NextResponse.json(saved, { status: 200 });
  } catch (error) {
    return scheduleErrorResponse(error);
  }
}
