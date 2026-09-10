import { NextResponse } from "next/server";
import { z } from "zod";

import { apiErrorResponse, getOrganizationContext } from "@/lib/api/organization-context";
import { localDaysBetween } from "@/domain/analysis/calendar";
import { MAX_ANALYSIS_WINDOW_DAYS } from "@/domain/analysis/window-selection";
import { createAuthenticatedChannelAnalysisRepository } from "@/modules/analysis/infrastructure/read-repository";
import { assertGovernedChannelAnalysisEnabled } from "@/modules/integrations/application/feature-access";

/**
 * What the Growth Intelligence performance loader polls while a picked
 * range's analyses are in flight.
 *
 * One aggregate over the channels the page dispatched (or found running),
 * built from the same per-channel read the Channel Audit status route uses:
 * the newest run for exactly this window, and whether its narration landed.
 * Four honest stages per channel, one overall verdict -- `ready` only when
 * nothing is left to wait for and at least one channel has something to
 * read, so the refresh it triggers always lands on figures.
 */

const paramsSchema = z.object({
  organizationId: z.string().uuid(),
});

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const querySchema = z
  .object({
    from: z.string().regex(LOCAL_DATE, "Use a YYYY-MM-DD date."),
    to: z.string().regex(LOCAL_DATE, "Use a YYYY-MM-DD date."),
    channels: z.string().min(1, "Name at least one channel."),
  })
  .superRefine((value, ctx) => {
    let span: number;
    try {
      span = localDaysBetween(value.from, value.to);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "That is not a real date." });
      return;
    }
    if (span < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "The end date is before the start." });
    }
    if (span > MAX_ANALYSIS_WINDOW_DAYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "That range is wider than one analysis can cover. Pick a shorter period.",
      });
    }
    const ids = value.channels.split(",");
    if (ids.length === 0 || ids.some((id) => !UUID.test(id))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Name channels by id." });
    }
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Name each channel once." });
    }
  });

type ChannelStage = "queued" | "running" | "narrating" | "ready" | "failed";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const routeParams = paramsSchema.parse(await params);
    const context = await getOrganizationContext(
      Promise.resolve({ organizationId: routeParams.organizationId }),
    );

    assertGovernedChannelAnalysisEnabled(routeParams.organizationId);

    const { searchParams } = new URL(request.url);
    const parsed = querySchema.parse({
      from: searchParams.get("from"),
      to: searchParams.get("to"),
      channels: searchParams.get("channels"),
    });
    const channelIds = [...new Set(parsed.channels.split(","))];

    const repository = createAuthenticatedChannelAnalysisRepository(context.supabase);
    const stages = await Promise.all(
      channelIds.map(async (channelId) => {
        const run = await repository.loadRunForWindow({
          organizationId: routeParams.organizationId,
          channelId,
          windowStart: parsed.from,
          windowEnd: parsed.to,
        });
        // The same four stages the Channel Audit loader reports: a completed
        // run whose narration has not landed is still being written, not
        // ready to read.
        const stage: ChannelStage =
          run === null
            ? "queued"
            : run.status === "failed"
              ? "failed"
              : run.status === "running"
                ? "running"
                : run.recommendationCount > 0
                  ? "ready"
                  : "narrating";
        return { channelId, stage };
      }),
    );

    const pending = stages.some(
      (entry) =>
        entry.stage === "queued" || entry.stage === "running" || entry.stage === "narrating",
    );
    const state = pending
      ? "building"
      : stages.some((entry) => entry.stage === "ready")
        ? "ready"
        : "failed";

    return NextResponse.json({ state, stages });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
