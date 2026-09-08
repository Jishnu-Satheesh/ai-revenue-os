import { NextResponse } from "next/server";
import { z } from "zod";

import { apiErrorResponse, getOrganizationContext } from "@/lib/api/organization-context";
import { localDaysBetween } from "@/domain/analysis/calendar";
import { MAX_ANALYSIS_WINDOW_DAYS } from "@/domain/analysis/window-selection";
import { createAuthenticatedChannelAnalysisRepository } from "@/modules/analysis/infrastructure/read-repository";
import { assertGovernedChannelAnalysisEnabled } from "@/modules/integrations/application/feature-access";

/**
 * What the Channel Audit loader polls while a range's analysis is in flight.
 *
 * The pipeline is two background steps, not one: a run computes findings and
 * completes, then a separate Trigger task narrates it (ADR 0037). "The run
 * finished" and "there is something to read" are different moments, so this
 * reports four honest stages built from two real facts -- whether the run row
 * exists and has completed, and whether its narration has landed -- rather
 * than collapsing them into a single "done" that would flash an empty page.
 */

const paramsSchema = z.object({
  organizationId: z.string().uuid(),
  channelId: z.string().uuid(),
});

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The same admissibility rules Task 8 applies to a picked range, read from the query string instead of a body. */
const querySchema = z
  .object({
    from: z.string().regex(LOCAL_DATE, "Use a YYYY-MM-DD date."),
    to: z.string().regex(LOCAL_DATE, "Use a YYYY-MM-DD date."),
  })
  .superRefine((value, ctx) => {
    let span: number;
    try {
      // Rejects the 31st of February rather than rolling it into March.
      span = localDaysBetween(value.from, value.to);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "That is not a real date." });
      return;
    }
    if (span < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "The end date is before the start." });
    }
    // `>` not `>=`, matching the database's `<= 400` check exactly. See Task 1.
    if (span > MAX_ANALYSIS_WINDOW_DAYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "That range is wider than one analysis can cover. Pick a shorter period.",
      });
    }
  });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string; channelId: string }> },
) {
  try {
    const routeParams = paramsSchema.parse(await params);
    const context = await getOrganizationContext(
      Promise.resolve({ organizationId: routeParams.organizationId }),
    );

    // Enforced before the read, so an organization the slice is off for cannot
    // reach it through a hand-typed URL.
    assertGovernedChannelAnalysisEnabled(routeParams.organizationId);

    const { searchParams } = new URL(request.url);
    const parsed = querySchema.parse({
      from: searchParams.get("from"),
      to: searchParams.get("to"),
    });

    const run = await createAuthenticatedChannelAnalysisRepository(
      context.supabase,
    ).loadRunForWindow({
      organizationId: routeParams.organizationId,
      channelId: routeParams.channelId,
      windowStart: parsed.from,
      windowEnd: parsed.to,
    });

    // Four stages from two facts. Nothing here is invented: each one is a
    // state the pipeline is genuinely in, which is why the loader can name
    // it without lying about progress.
    const stage =
      run === null
        ? "queued"
        : run.status === "failed"
          ? "failed"
          : run.status === "running"
            ? "running"
            : run.recommendationCount > 0
              ? "ready"
              : "narrating";

    return NextResponse.json({ stage, analysisRunId: run?.id ?? null });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
