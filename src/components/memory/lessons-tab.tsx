"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronDown, Lightbulb, TriangleAlert } from "lucide-react";

import { ItemChainDialog } from "@/components/memory/item-chain-dialog";
import { ProvenanceBadges } from "@/components/memory/provenance-badges";
import {
  memoryItemQueryOptions,
  memoryLessonsQueryOptions,
} from "@/components/memory/query-options";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import type { Freshness, Sensitivity, VerificationState } from "@/domain/memory/types";
import type { OrganizationRole } from "@/domain/organizations/types";
import type { MemoryItemView } from "@/modules/memory/application/service";

const typeLabels: Readonly<Record<string, string>> = {
  lesson: "Lesson",
  decision: "Decision",
  outcome: "Outcome",
};

/**
 * Supporting evidence is read only when an operator opens it. The lessons route
 * returns evidence identifiers that already passed the caller's sensitivity
 * ceiling, but an item can become unreadable between the two reads, so a failed
 * evidence read is reported as unavailable rather than dropped or guessed at.
 */
function EvidenceList({
  organizationId,
  evidenceIds,
}: {
  organizationId: string;
  evidenceIds: readonly string[];
}) {
  const evidenceQueries = useQueries({
    queries: evidenceIds.map((itemId) =>
      memoryItemQueryOptions({ organizationId, itemId, enabled: true }),
    ),
  });

  return (
    <ul className="mt-2 space-y-1.5 border-l pl-3">
      {evidenceIds.map((itemId, index) => {
        const query = evidenceQueries[index];
        if (query?.isPending) {
          return (
            <li key={itemId}>
              <Skeleton className="h-8 w-full rounded-md" />
            </li>
          );
        }
        if (!query || query.isError || !query.data) {
          return (
            <li key={itemId} className="text-xs text-muted-foreground">
              This evidence is no longer available to you.
            </li>
          );
        }
        const evidence = query.data.item;
        return (
          <li key={itemId} className="space-y-1">
            <p className="text-xs font-medium">{evidence.title}</p>
            <ProvenanceBadges
              verificationState={evidence.verificationState as VerificationState}
              freshness={evidence.freshness as Freshness}
              sensitivity={evidence.sensitivity}
              origin={evidence.origin}
              sourceTier={evidence.sourceTier}
              sourceSystem={evidence.sourceSystem}
            />
          </li>
        );
      })}
    </ul>
  );
}

function LessonCard({
  organizationId,
  lesson,
  evidenceIds,
  role,
  ceiling,
}: {
  organizationId: string;
  lesson: MemoryItemView;
  evidenceIds: readonly string[];
  role: OrganizationRole;
  ceiling: Sensitivity;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="gap-0 py-0 shadow-sm">
      <CardContent className="space-y-2.5 px-4 py-3.5">
        <div className="space-y-2">
          <Badge variant="secondary" className="text-[10px] uppercase">
            {typeLabels[lesson.memoryType] ?? lesson.memoryType}
          </Badge>
          <h4 className="text-sm leading-snug font-semibold break-words">{lesson.title}</h4>
          <ProvenanceBadges
            verificationState={lesson.verificationState as VerificationState}
            freshness={lesson.freshness as Freshness}
            sensitivity={lesson.sensitivity}
            origin={lesson.origin}
            sourceTier={lesson.sourceTier}
            sourceSystem={lesson.sourceSystem}
            confidence={lesson.confidence}
            embeddingStatus={lesson.embeddingStatus}
          />
        </div>

        {lesson.body ? (
          <p className="text-sm text-muted-foreground">{lesson.body}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Body withheld at your access level. Provenance below stays auditable.
          </p>
        )}

        {evidenceIds.length > 0 ? (
          <Collapsible open={expanded} onOpenChange={setExpanded}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 rounded text-xs font-medium underline-offset-2 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <ChevronDown
                  aria-hidden="true"
                  className={
                    expanded
                      ? "size-3 rotate-180 transition-transform"
                      : "size-3 transition-transform"
                  }
                />
                {evidenceIds.length} supporting {evidenceIds.length === 1 ? "item" : "items"}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              {/* Mounted only once opened, so the privileged reads happen on demand. */}
              {expanded ? (
                <EvidenceList organizationId={organizationId} evidenceIds={evidenceIds} />
              ) : null}
            </CollapsibleContent>
          </Collapsible>
        ) : (
          <p className="text-xs text-muted-foreground">No supporting evidence is linked.</p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-2.5">
          <ItemChainDialog
            organizationId={organizationId}
            item={lesson}
            role={role}
            ceiling={ceiling}
          />
        </div>
      </CardContent>
    </Card>
  );
}

export function LessonsTab({
  organizationId,
  role,
  ceiling,
}: {
  organizationId: string;
  role: OrganizationRole;
  ceiling: Sensitivity;
}) {
  const lessonsQuery = useQuery(memoryLessonsQueryOptions({ organizationId }));

  if (lessonsQuery.isPending) {
    return (
      <div className="space-y-3" data-testid="memory-lessons-skeleton">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    );
  }

  // A malformed 200 leaves `data` empty. That is an error to report, not a
  // shape to destructure.
  if (lessonsQuery.isError || !lessonsQuery.data?.items) {
    return (
      <Alert variant="destructive" aria-labelledby="memory-lessons-error">
        <TriangleAlert />
        <AlertTitle id="memory-lessons-error">Lessons could not be loaded</AlertTitle>
        <AlertDescription>
          {lessonsQuery.error instanceof Error
            ? lessonsQuery.error.message
            : "Lessons could not be read."}
        </AlertDescription>
      </Alert>
    );
  }

  const { items, evidence } = lessonsQuery.data;

  if (items.length === 0) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Lightbulb />
          </EmptyMedia>
          <EmptyTitle>No lessons recorded yet</EmptyTitle>
          <EmptyDescription>
            Lessons, decisions, and outcomes appear here once the organization records what it
            learned and what followed.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      {items.map((lesson) => (
        <LessonCard
          key={lesson.id}
          organizationId={organizationId}
          lesson={lesson}
          evidenceIds={evidence[lesson.id] ?? []}
          role={role}
          ceiling={ceiling}
        />
      ))}
    </div>
  );
}
