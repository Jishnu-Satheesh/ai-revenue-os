"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";

import { Spinner } from "@/components/ui/spinner";

export type AnalysisStage = "queued" | "running" | "narrating" | "ready" | "failed";

const PROGRESS_STAGES: { stage: Exclude<AnalysisStage, "failed">; line: string }[] = [
  { stage: "queued", line: "Reading approved reports" },
  { stage: "running", line: "Running the checks" },
  { stage: "narrating", line: "Writing recommendations" },
  { stage: "ready", line: "Ready" },
];

const KNOWN_STAGES: readonly string[] = ["queued", "running", "narrating", "ready", "failed"];

const FAILED_LINE =
  "This analysis could not be completed. Nothing was changed; try again in a moment.";

export function AnalysisProgress(props: {
  organizationId: string;
  channelId: string;
  window: { from: string; to: string };
  onReady: () => void;
  pollMs?: number;
}): ReactElement {
  const { organizationId, channelId, window: range, onReady, pollMs = 1500 } = props;
  const [stage, setStage] = useState<AnalysisStage>("queued");
  const onReadyRef = useRef(onReady);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    const url =
      `/api/organizations/${organizationId}/channels/${channelId}/analysis/status` +
      `?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
    const controller = new AbortController();
    let stopped = false;

    async function poll(): Promise<void> {
      if (stopped) {
        return;
      }
      let next: AnalysisStage;
      try {
        const response = await fetch(url, { signal: controller.signal });
        const body = (await response.json()) as { stage: AnalysisStage };
        if (!KNOWN_STAGES.includes(body.stage)) {
          return;
        }
        next = body.stage;
      } catch {
        // A dropped poll is not a failed analysis: keep the previous stage
        // and keep polling.
        return;
      }
      if (stopped) {
        return;
      }
      setStage(next);
      if (next === "ready") {
        stopped = true;
        clearInterval(timer);
        onReadyRef.current();
      } else if (next === "failed") {
        stopped = true;
        clearInterval(timer);
      }
    }

    const timer = setInterval(() => {
      void poll();
    }, pollMs);
    void poll();

    return () => {
      stopped = true;
      clearInterval(timer);
      controller.abort();
    };
  }, [organizationId, channelId, range.from, range.to, pollMs]);

  if (stage === "failed") {
    return (
      <p role="status" aria-live="polite">
        {FAILED_LINE}
      </p>
    );
  }

  const currentIndex = PROGRESS_STAGES.findIndex((entry) => entry.stage === stage);

  return (
    <ol role="status" aria-live="polite">
      {PROGRESS_STAGES.map((entry, index) => (
        <li key={entry.stage} aria-current={index === currentIndex ? "step" : undefined}>
          {entry.line}
          {index === currentIndex ? <Spinner /> : null}
        </li>
      ))}
    </ol>
  );
}
