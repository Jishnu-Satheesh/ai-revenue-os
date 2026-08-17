import { z } from "zod";

import { CHANNEL_CAPABILITY_KEYS } from "@/domain/campaigns/channel-capabilities";

/**
 * Per-channel execution readiness, read through the caller's own session.
 *
 * The database function behind this is read-only and runs as the invoker, so
 * row level security decides what comes back. That matters more than it looks:
 * an operator opening a campaign must not be able to learn anything about
 * another organization's connections, and the surest way to guarantee that is
 * to never step outside their own permissions to answer the question.
 */

const readinessRowSchema = z.object({
  channel: z.string(),
  capabilityKey: z.string().nullable(),
  actionCount: z.number().int().nonnegative(),
  anyRequired: z.boolean(),
  firstScheduledFor: z.string().nullable(),
  accountLabel: z.string().nullable(),
  restrictionCodes: z.array(z.string()),
  verdict: z.enum(["ready", "blocked"]),
  codes: z.array(z.string()),
});

export type ChannelReadiness = z.infer<typeof readinessRowSchema>;

export type ReadinessRpcSource = {
  rpc(
    name: "campaign_version_channel_readiness",
    args: {
      target_organization_id: string;
      target_bundle_version_id: string;
      input_channel_capabilities: Record<string, string>;
    },
  ): Promise<{ data: unknown; error: unknown }>;
};

/**
 * The readiness of every channel this version wants to use.
 *
 * Returns `null` rather than an empty list when the answer could not be
 * obtained. Those are different facts and the screen renders them differently:
 * an empty list means this version publishes nowhere, while `null` means the
 * platform does not currently know, and a panel that showed "nothing blocking"
 * for the second case would be inventing reassurance.
 */
export async function readChannelReadiness(
  source: ReadinessRpcSource,
  input: { organizationId: string; bundleVersionId: string },
): Promise<readonly ChannelReadiness[] | null> {
  const { data, error } = await source.rpc("campaign_version_channel_readiness", {
    target_organization_id: input.organizationId,
    target_bundle_version_id: input.bundleVersionId,
    input_channel_capabilities: { ...CHANNEL_CAPABILITY_KEYS },
  });

  if (error) return null;

  const parsed = z.array(readinessRowSchema).safeParse(data);
  // A shape the platform does not recognize is not a green light. Better to
  // say nothing is known than to guess at a verdict from a partial row.
  return parsed.success ? parsed.data : null;
}
