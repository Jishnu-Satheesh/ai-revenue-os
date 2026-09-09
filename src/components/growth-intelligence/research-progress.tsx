"use client";

import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  RESEARCH_ACTIVE_POLL_MS,
  RESEARCH_ERROR_BACKOFF_MS,
  isActivePipelineStage,
} from "@/components/growth-intelligence/query-options";
import type { ResearchPipelineView } from "@/modules/growth-intelligence/application/research-read-model";

export type ResearchPipelineStatus = "loading" | "ready" | "unavailable";

export type UseResearchPipelineResult = {
  active: ResearchPipelineView | null;
  history: ResearchPipelineView[];
  lastSuccess: ResearchPipelineView | null;
  /** Loading, settled, or read-error. A read error is reported as Status unavailable. */
  status: ResearchPipelineStatus;
};

/**
 * Observe one branch's research pipeline. Polls every 5 seconds while a
 * pipeline is active, backs off to 30 seconds after a read error, pauses
 * while the tab is hidden or the browser is offline, and rechecks
 * immediately on return. A slower older-branch response can never overwrite
 * the current branch: every response is ignored unless it still belongs to
 * the mounted branch generation. Remounting resumes from the authoritative
 * read with the caller-supplied initial state shown meanwhile.
 */
export function useResearchPipeline({
  organizationId,
  branchId,
  initialActive,
  onTransition,
}: {
  organizationId: string;
  branchId: string | null;
  initialActive?: ResearchPipelineView | null;
  /** Called on preparing_insights and once per terminal transition. */
  onTransition?: (pipeline: ResearchPipelineView) => void;
}): UseResearchPipelineResult {
  const [active, setActive] = useState<ResearchPipelineView | null>(initialActive ?? null);
  const [history, setHistory] = useState<ResearchPipelineView[]>([]);
  const [lastSuccess, setLastSuccess] = useState<ResearchPipelineView | null>(null);
  const [status, setStatus] = useState<ResearchPipelineStatus>(initialActive ? "ready" : "loading");
  const seenStage = useRef<string | null>(initialActive?.stage ?? null);
  const notifiedTerminal = useRef<string | null>(null);
  const onTransitionRef = useRef(onTransition);
  onTransitionRef.current = onTransition;

  useEffect(() => {
    notifiedTerminal.current = null;
    seenStage.current = null;
    if (branchId === null) {
      setActive(null);
      setHistory([]);
      setLastSuccess(null);
      setStatus("ready");
      return;
    }
    // Remount and branch switches resume from the authoritative read; the
    // previous branch stays on screen only until its replacement arrives,
    // and a late response for it is discarded below.
    setActive(initialActive ?? null);
    setHistory([]);
    setLastSuccess(null);
    setStatus("loading");
    seenStage.current = initialActive?.stage ?? null;

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let backoff = false;
    const controller = new AbortController();

    async function read() {
      if (disposed || branchId === null) return;
      if (document.visibilityState === "hidden" || !window.navigator.onLine) return;
      let body: {
        research: {
          active: ResearchPipelineView | null;
          history: { pipelines: ResearchPipelineView[]; nextCursor: string | null } | null;
          lastSuccess: ResearchPipelineView | null;
        } | null;
      };
      try {
        const response = await fetch(
          `/api/organizations/${organizationId}/growth-intelligence?branchId=${encodeURIComponent(branchId)}&historyLimit=1`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) throw new Error("RESEARCH_READ_FAILED");
        body = (await response.json()) as typeof body;
      } catch (error) {
        if (disposed || (error instanceof DOMException && error.name === "AbortError")) return;
        // A read error means Status unavailable, never research failure.
        backoff = true;
        if (!disposed) setStatus("unavailable");
        schedule();
        return;
      }
      if (disposed) return;
      backoff = false;
      const next = body.research?.active ?? null;
      setActive(next);
      setHistory(body.research?.history?.pipelines ?? []);
      setLastSuccess(body.research?.lastSuccess ?? null);
      setStatus("ready");
      if (next && seenStage.current !== next.stage) {
        seenStage.current = next.stage;
        if (
          next.stage === "preparing_insights" ||
          (!isActivePipelineStage(next.stage) && notifiedTerminal.current !== next.pipelineId)
        ) {
          if (!isActivePipelineStage(next.stage)) notifiedTerminal.current = next.pipelineId;
          onTransitionRef.current?.(next);
        }
      }
      schedule();
    }

    function schedule() {
      if (disposed || branchId === null) return;
      // Terminal pipelines settle: one final read already happened above.
      if (seenStage.current !== null && !isActivePipelineStage(seenStage.current)) return;
      timer = setTimeout(read, backoff ? RESEARCH_ERROR_BACKOFF_MS : RESEARCH_ACTIVE_POLL_MS);
    }

    function recheck() {
      if (disposed) return;
      if (document.visibilityState === "hidden" || !window.navigator.onLine) return;
      if (timer) clearTimeout(timer);
      void read();
    }

    // Seed the observed stage from the initial view so a remount that
    // resumes mid-run still transitions exactly once per stage change.
    if (initialActive && !isActivePipelineStage(initialActive.stage)) {
      notifiedTerminal.current = initialActive.pipelineId;
    }
    void read();
    document.addEventListener("visibilitychange", recheck);
    window.addEventListener("online", recheck);
    return () => {
      disposed = true;
      controller.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", recheck);
      window.removeEventListener("online", recheck);
    };
    // initialActive is intentionally read once per mount/branch: polling
    // updates flow through the loop above, never through prop churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, branchId]);

  return { active, history, lastSuccess, status };
}

function coverageCounts(pipeline: ResearchPipelineView): { searched: number; supported: number } {
  let searched = 0;
  let supported = 0;
  for (const entry of pipeline.coverage) {
    if (
      entry.outcome === "not_started" ||
      entry.outcome === "skipped_budget" ||
      entry.outcome === "skipped_policy"
    ) {
      continue;
    }
    searched += 1;
    if (entry.outcome === "supported") supported += 1;
  }
  return { searched, supported };
}

/**
 * Live pipeline progress inside Insights & market: stage, branch,
 * settings/time, searched/supported coverage and source count. Evidence
 * stays visible while preparing_insights and after synthesis failure; the
 * component only reports what the read contract hands over.
 */
export function ResearchProgress({
  organizationId,
  pipeline,
  timeZone,
  loadError,
}: {
  organizationId: string;
  pipeline: ResearchPipelineView | null;
  timeZone: string;
  loadError?: "network" | null;
}) {
  if (loadError) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Research status unavailable. Your saved insights below are unchanged.
        </CardContent>
      </Card>
    );
  }
  if (!pipeline) return null;
  const { searched, supported } = coverageCounts(pipeline);
  const settings = pipeline.settingsSummary;
  return (
    <Card data-testid={`research-progress-${pipeline.pipelineId}`}>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{pipeline.stageDisplay}</CardTitle>
          <Badge variant={pipeline.active ? "default" : "secondary"}>{pipeline.scopeLabel}</Badge>
          {pipeline.legacyScope ? <Badge variant="outline">Organization</Badge> : null}
        </div>
        <CardDescription>
          Observed{" "}
          {new Date(pipeline.observedAt).toLocaleDateString("en-AE", {
            timeZone,
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {settings ? (
          <p className="text-muted-foreground">
            Following {settings.topics.length > 0 ? settings.topics.join(", ") : "no topics"}
            {settings.competitorNames.length > 0
              ? ` · watching ${settings.competitorNames.join(", ")}`
              : null}
          </p>
        ) : null}
        <p className="text-muted-foreground">
          {searched} searched · {supported} supported · {pipeline.sourceCount} sources
        </p>
        <a
          className="text-xs font-medium text-primary underline-offset-4 hover:underline"
          href={pipeline.outcomeLinks.self}
        >
          View exact status
        </a>
        <span className="hidden">{organizationId}</span>
      </CardContent>
    </Card>
  );
}
