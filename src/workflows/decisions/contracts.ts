import { createHash } from "node:crypto";

import { z } from "zod";

export { DecisionConfigurationError } from "@/domain/decisions/errors";

export const campaignDecisionCyclePayloadSchema = z.strictObject({
  organizationId: z.string().uuid(),
  correlationId: z.string().uuid(),
  idempotencyKey: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/),
  triggerType: z.enum(["manual", "scheduled", "integration_sync_completed"]),
});
export type CampaignDecisionCyclePayload = z.infer<typeof campaignDecisionCyclePayloadSchema>;

export function parseCampaignDecisionCyclePayload(input: unknown): CampaignDecisionCyclePayload {
  return campaignDecisionCyclePayloadSchema.parse(input);
}

export function decisionCycleRequestDigest(payload: CampaignDecisionCyclePayload): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        organizationId: payload.organizationId,
        correlationId: payload.correlationId,
        idempotencyKey: payload.idempotencyKey,
        triggerType: payload.triggerType,
      }),
      "utf8",
    )
    .digest("hex");
}
