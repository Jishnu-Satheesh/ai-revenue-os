import type { ChannelAnalysisReadPort, ChannelAnalysisRunRecord } from "./ports";
import { z } from "zod";

type Window = { from: string; to: string };

export async function resolveAuditSelection(input: {
  organizationId: string;
  channelId: string;
  requestedRunId?: string;
  runs: readonly ChannelAnalysisRunRecord[];
  defaultWindow: Window | null;
  loadRun: ChannelAnalysisReadPort["loadRun"];
}): Promise<{ window: Window | null; displayedRun: ChannelAnalysisRunRecord | null; runs: ChannelAnalysisRunRecord[] }> {
  if (input.requestedRunId && z.uuid().safeParse(input.requestedRunId).success) {
    // This reader filters by organization and channel, even when the requested
    // run is older than the page's ten-row recent list.
    const named = await input.loadRun({
      organizationId: input.organizationId,
      channelId: input.channelId,
      analysisRunId: input.requestedRunId,
    });
    if (named?.status === "completed" && named.channelId === input.channelId) {
      return {
        window: { from: named.windowStart, to: named.windowEnd },
        displayedRun: named,
        runs: input.runs.some((run) => run.id === named.id) ? [...input.runs] : [...input.runs, named],
      };
    }
  }
  const displayedRun = input.defaultWindow
    ? input.runs.find((run) => run.status === "completed" &&
      run.windowStart === input.defaultWindow!.from && run.windowEnd === input.defaultWindow!.to) ?? null
    : null;
  return { window: input.defaultWindow, displayedRun, runs: [...input.runs] };
}
