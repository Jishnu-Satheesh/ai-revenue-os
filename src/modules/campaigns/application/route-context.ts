import { z } from "zod";

import { DomainError } from "@/lib/errors";
import { getOrganizationContext } from "@/lib/api/organization-context";
import { rolesWith, type CampaignPermission } from "@/domain/campaigns/permissions";
import { assertCampaignsEnabled } from "@/modules/campaigns/application/feature-access";

/**
 * The same authorization order for every campaign route.
 *
 * Membership first, then the rollout gate, then the parsed body. The order is
 * the point: checking the gate before membership would let an outsider tell
 * "not enabled" from "not a member" and enumerate which organizations exist.
 *
 * Having one helper rather than the same six lines in nine files means the
 * order cannot drift in a route someone adds later.
 */
export async function campaignRouteContext(
  params: Promise<{ organizationId: string }>,
  permission: CampaignPermission,
) {
  const context = await getOrganizationContext(params, rolesWith(permission));
  assertCampaignsEnabled(context.organizationId);
  return context;
}

const campaignIdSchema = z.string().uuid();

export function parseCampaignId(value: string): string {
  const parsed = campaignIdSchema.safeParse(value);
  if (!parsed.success) throw new DomainError("VALIDATION_ERROR", "Campaign ID is invalid.");
  return parsed.data;
}

/** Malformed JSON is a validation failure, never an unhandled exception. */
export async function parseJsonBody(request: Request): Promise<unknown> {
  return request.json().catch(() => {
    throw new DomainError("VALIDATION_ERROR", "The request body is not valid JSON.");
  });
}
