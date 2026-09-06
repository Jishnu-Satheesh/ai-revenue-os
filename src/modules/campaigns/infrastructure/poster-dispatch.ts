import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  campaignPlateEditPayloadSchema,
  campaignPosterRenderPayloadSchema,
  type CampaignPlateEditPayload,
  type CampaignPosterRenderPayload,
} from "@/workflows/campaigns/contracts";
import type { editCampaignPlateTask, renderCampaignPosterTask } from "@/trigger/campaigns";

/**
 * Handing a render or an edit to the worker that performs it.
 *
 * Neither of these writes a run row first, and that is a real difference from
 * generation rather than an omission. A render is content-addressed: the
 * database's unique key is a digest over the inputs, so a second delivery of
 * the same request finds the row already written and replays it. There is
 * nothing to claim and nothing to lease.
 *
 * A dispatch that fails is therefore not recoverable by a background sweep --
 * no row says the work is owed -- so a failure is raised to the caller rather
 * than logged and swallowed. An operator who is told "try again" is better off
 * than one watching a spinner for work nobody is doing.
 */

type Dispatchable = typeof renderCampaignPosterTask | typeof editCampaignPlateTask;

async function dispatch(
  taskId: "campaign.render-poster" | "campaign.edit-plate",
  payload: CampaignPosterRenderPayload | CampaignPlateEditPayload,
  idempotencyKey: string,
  failureMessage: string,
): Promise<{ workerId: string }> {
  try {
    const { tasks } = await import("@trigger.dev/sdk");
    const handle = await tasks.trigger<Dispatchable>(taskId, payload, {
      // The organization is the concurrency key, so one tenant queuing a batch
      // of renders cannot starve another tenant's single one.
      idempotencyKey,
      concurrencyKey: payload.organizationId,
    });

    logger.info("campaign.poster_work_dispatched", {
      organizationId: payload.organizationId,
      campaignId: payload.campaignId,
      correlationId: payload.correlationId,
      workerId: handle.id,
    });

    return { workerId: handle.id };
  } catch (error) {
    logger.error("campaign.poster_work_not_dispatched", {
      organizationId: payload.organizationId,
      campaignId: payload.campaignId,
      correlationId: payload.correlationId,
      errorCode: error instanceof Error ? error.name : "unknown",
    });
    throw new DomainError("WORKFLOW_ERROR", failureMessage);
  }
}

/**
 * The idempotency key for a render.
 *
 * Derived from the request rather than supplied by the caller, because the
 * database's own key already is: the render digest covers the plate, the
 * template, the words and the fonts. A caller-chosen key would let two
 * identical requests take two Trigger slots to reach the same replayed row.
 *
 * `extra` is included because it is drawn, so two requests differing only in
 * the free box are genuinely different renders.
 */
export function posterRenderIdempotencyKey(payload: CampaignPosterRenderPayload): string {
  return [
    "poster",
    payload.bundleVersionId,
    payload.plateAssetId,
    payload.templateKey,
    payload.templateVersion,
    payload.script,
    payload.directionId,
    payload.channel,
    payload.extra ?? "",
  ].join(":");
}

export async function dispatchPosterRender(
  input: CampaignPosterRenderPayload,
): Promise<{ workerId: string }> {
  const payload = campaignPosterRenderPayloadSchema.parse(input);
  return dispatch(
    "campaign.render-poster",
    payload,
    posterRenderIdempotencyKey(payload),
    "The poster could not be queued for rendering. Try again.",
  );
}

export async function dispatchPlateEdit(
  input: CampaignPlateEditPayload,
): Promise<{ workerId: string }> {
  const payload = campaignPlateEditPayloadSchema.parse(input);
  // The caller's key, not a derived one: an edit is not content-addressed, and
  // the database enforces one edit per key per organization.
  return dispatch(
    "campaign.edit-plate",
    payload,
    `plate-edit:${payload.organizationId}:${payload.idempotencyKey}`,
    "The edit could not be queued. Try again.",
  );
}
