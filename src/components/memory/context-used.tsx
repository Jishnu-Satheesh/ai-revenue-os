"use client";

import { useState } from "react";
import { Database } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * What the narrator read alongside the findings, per recommendation.
 *
 * Reusable drawer for the channel recommendation detail view. Entries informed
 * wording only: every claim in the answer cites a finding id, never a shared
 * entry, so nothing here names a cause and nothing claims an entry produced
 * the advice. Provided-to-AI vs cited-in-answer and shared-with-Google vs
 * internal-only are shown as separate labels because they answer different
 * questions — what the model saw, and where those words were allowed to go.
 */

export type ContextUsedEntry = {
  contextRef: string;
  title: string;
  summary: string;
  sourceKind: string;
  sourceId: string;
  /** ISO timestamp the source was observed, or null when not recorded. */
  captureDate: string | null;
  providedToAi: boolean;
  citedInAnswer: boolean;
  sharedWithGoogle: boolean;
};

export type ContextUsedData = {
  shareMode: "internal_only" | "grounded_share";
  manifestId: string | null;
  /** Mirrors the manifest vocabulary; null when no manifest was pinned. */
  manifestStatus: "ready" | "empty" | "partial" | "unavailable" | "disabled" | null;
  entries: ContextUsedEntry[];
};

const sourceKindLabels: Readonly<Record<string, string>> = {
  memory_item: "Memory note",
  capture_event: "Captured event",
  business_fact: "Business fact",
  business_profile: "Business profile",
  goal: "Goal",
  constraint: "Constraint",
  campaign_version: "Campaign version",
};

function sourceKindLabel(sourceKind: string): string {
  return sourceKindLabels[sourceKind] ?? sourceKind;
}

function formatCaptureDate(value: string | null): string {
  if (!value) return "Capture date not recorded";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "Capture date not recorded";
  return new Date(parsed).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Safe visible manifest payload served by the contexts route (no raw bodies). */
export type ContextManifestPayload = {
  manifest: {
    id: string;
    status: ContextUsedData["manifestStatus"];
    policyVersion: string;
    selectedCount: number;
    asOf: string;
  };
  entries: {
    contextRef: string;
    title: string;
    summary: string;
    sourceKind: string;
    sourceId: string;
    observedAt: string | null;
  }[];
};

export type ContextProvenance = {
  shareMode: ContextUsedData["shareMode"];
  providedRefs: readonly string[];
  citedRefs: readonly string[];
} | null;

/**
 * Org-scoped query for one pinned manifest. Disabled without a manifest id so
 * evidence-only answers never fire a read they cannot use.
 */
export function contextUsedQueryOptions(input: {
  organizationId: string;
  manifestId: string | null;
}) {
  return {
    queryKey: ["organizations", input.organizationId, "memory", "contexts", input.manifestId ?? ""] as const,
    queryFn: async (): Promise<ContextManifestPayload> => {
      const response = await fetch(
        `/api/organizations/${input.organizationId}/memory/contexts/${input.manifestId}`,
      );
      if (!response.ok) throw new Error("The used context could not be read.");
      return (await response.json()) as ContextManifestPayload;
    },
    enabled: input.manifestId !== null,
    staleTime: 30_000,
  };
}

/**
 * Maps a manifest payload plus optional per-recommendation provenance into
 * drawer data. Without provenance every pinned entry counts as provided and
 * none as cited; without a payload the answer is evidence-only and the drawer
 * shows the degraded copy instead of an entries list.
 */
export function toContextUsedData(
  payload: ContextManifestPayload | null,
  provenance: ContextProvenance,
): ContextUsedData | null {
  if (!payload) return null;
  const provided = new Set(provenance?.providedRefs ?? payload.entries.map((entry) => entry.contextRef));
  const cited = new Set(provenance?.citedRefs ?? []);
  const shareMode = provenance?.shareMode ?? "internal_only";
  return {
    shareMode,
    manifestId: payload.manifest.id,
    manifestStatus: payload.manifest.status,
    entries: payload.entries.map((entry) => ({
      contextRef: entry.contextRef,
      title: entry.title,
      summary: entry.summary,
      sourceKind: entry.sourceKind,
      sourceId: entry.sourceId,
      captureDate: entry.observedAt,
      providedToAi: provided.has(entry.contextRef),
      citedInAnswer: cited.has(entry.contextRef),
      sharedWithGoogle: shareMode === "grounded_share" && provided.has(entry.contextRef),
    })),
  };
}

function EntryRow({ entry, organizationId }: { entry: ContextUsedEntry; organizationId: string }) {
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="gap-1 font-normal">
          {entry.providedToAi ? "Provided to AI" : "Not provided"}
        </Badge>
        {entry.citedInAnswer ? (
          <Badge variant="outline" className="gap-1 font-normal">
            Cited in answer
          </Badge>
        ) : null}
        <Badge variant="outline" className="gap-1 font-normal">
          {entry.sharedWithGoogle ? "Shared with Google" : "Internal only"}
        </Badge>
      </div>
      <p className="text-xs font-semibold">{entry.title}</p>
      <p className="text-xs leading-relaxed text-muted-foreground">{entry.summary}</p>
      <p className="text-[11px] text-muted-foreground">
        {sourceKindLabel(entry.sourceKind)} · captured {formatCaptureDate(entry.captureDate)}
      </p>
      <a
        href={`/organizations/${organizationId}/memory`}
        className="text-[11px] font-medium underline-offset-2 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        Open in Business Memory
      </a>
    </li>
  );
}

export function ContextUsedDrawer({
  organizationId,
  recommendationHeadline,
  data,
  pending = false,
  loadError = false,
}: {
  organizationId: string;
  recommendationHeadline: string;
  /** Null while the provenance read resolves; absent entries render degraded copy, never a spinner forever. */
  data: ContextUsedData | null;
  pending?: boolean;
  loadError?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const providedCount = data?.entries.filter((entry) => entry.providedToAi).length ?? 0;
  const unavailable = data?.manifestStatus === "unavailable";
  const disabled = data?.manifestStatus === "disabled";

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs font-semibold text-muted-foreground"
        >
          <Database aria-hidden="true" className="size-3.5" />
          {pending ? "Reading context…" : `Context used${data ? ` (${providedCount})` : ""}`}
        </Button>
      </SheetTrigger>
      <SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
        <SheetHeader className="border-b px-5 py-4 text-left">
          <SheetTitle className="text-base">Context used</SheetTitle>
          <SheetDescription>
            What the narrator read alongside the findings for “{recommendationHeadline}”. Entries
            informed wording only; every claim in the answer cites a finding.
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {pending ? (
            <div className="space-y-2" data-testid="context-used-skeleton">
              <Skeleton className="h-6 w-2/3 rounded-md" />
              <Skeleton className="h-24 w-full rounded-md" />
            </div>
          ) : loadError || data === null ? (
            <Alert>
              <AlertTitle>Context could not be read</AlertTitle>
              <AlertDescription>
                The used context could not be read just now. The answer and its cited findings are
                unaffected.
              </AlertDescription>
            </Alert>
          ) : unavailable ? (
            <Alert>
              <AlertTitle>Business Memory was unavailable when this answer was written</AlertTitle>
              <AlertDescription>
                The answer rests on findings only. Nothing was shared, and no context is claimed.
              </AlertDescription>
            </Alert>
          ) : disabled ? (
            <Alert>
              <AlertTitle>Business Memory context is switched off</AlertTitle>
              <AlertDescription>
                The answer rests on findings only. Switch context on to let future answers read
                approved memory.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              {data.shareMode === "grounded_share" ? (
                <Alert>
                  <AlertTitle>Shared with Google</AlertTitle>
                  <AlertDescription>
                    A small labeled subset was sent to Google&apos;s model with grounding, under
                    consent. Confidential and customer content never shares.
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert>
                  <AlertTitle>Internal only</AlertTitle>
                  <AlertDescription>
                    Nothing left this organization for this answer.
                  </AlertDescription>
                </Alert>
              )}
              {data.entries.length === 0 ? (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  No Business Memory entries qualified for this answer. The answer rests on findings
                  only.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {data.entries.map((entry) => (
                    <EntryRow key={entry.contextRef} entry={entry} organizationId={organizationId} />
                  ))}
                </ul>
              )}
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Entries never replace cited findings. They show what the narrator saw, not what the
                answer rests on.
              </p>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
