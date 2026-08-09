"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Clock3, TriangleAlert } from "lucide-react";

import { ItemChainDialog } from "@/components/memory/item-chain-dialog";
import { ProvenanceBadges } from "@/components/memory/provenance-badges";
import { memoryTimelineQueryOptions } from "@/components/memory/query-options";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Freshness, Sensitivity, VerificationState } from "@/domain/memory/types";
import type { OrganizationRole } from "@/domain/organizations/types";
import type { MemoryBranchOption } from "@/modules/memory/application/ports";
import type { MemoryItemView } from "@/modules/memory/application/service";

function formatObserved(item: MemoryItemView): string {
  const value = item.observedAt ?? item.createdAt;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "Date not recorded";
  const label = `${new Date(parsed).toISOString().replace("T", " ").slice(0, 16)} UTC`;
  return item.observedAt ? `Observed ${label}` : `Recorded ${label}`;
}

const ALL_BRANCHES = "__all_branches__";

export function TimelineTab({
  organizationId,
  role,
  ceiling,
  branches,
}: {
  organizationId: string;
  role: OrganizationRole;
  ceiling: Sensitivity;
  branches: readonly MemoryBranchOption[];
}) {
  const [sourceSystems, setSourceSystems] = useState<string[]>([]);
  const [branch, setBranch] = useState<string>(ALL_BRANCHES);
  const timelineQuery = useInfiniteQuery(
    memoryTimelineQueryOptions({
      organizationId,
      filters: { sourceSystems, branchId: branch === ALL_BRANCHES ? undefined : branch },
    }),
  );

  const items = useMemo(
    () => timelineQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [timelineQuery.data],
  );

  // The source filter offers only systems the loaded rows actually carry; the
  // branch filter offers only branches the snapshot returned under this
  // reader's own RLS context. Neither invents an option.
  const availableSources = useMemo(() => {
    const present = new Set<string>(sourceSystems);
    for (const item of items) if (item.sourceSystem) present.add(item.sourceSystem);
    return [...present].sort();
  }, [items, sourceSystems]);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {branches.length > 0 ? (
          <>
            <Label className="shrink-0 text-xs text-muted-foreground">Branch</Label>
            <Select value={branch} onValueChange={setBranch}>
              <SelectTrigger size="sm" aria-label="Branch" className="w-48 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_BRANCHES}>All branches</SelectItem>
                {branches.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        ) : null}
        <Label className="shrink-0 text-xs text-muted-foreground">Source</Label>
        {availableSources.length > 0 ? (
          <ToggleGroup
            type="multiple"
            size="sm"
            variant="outline"
            aria-label="Source system"
            value={sourceSystems}
            onValueChange={setSourceSystems}
            className="flex-wrap"
          >
            {availableSources.map((source) => (
              <ToggleGroupItem key={source} value={source} className="px-2 text-xs">
                {source}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : (
          <span className="text-xs text-muted-foreground">
            No source system is recorded on these entries.
          </span>
        )}
        {timelineQuery.isFetching ? (
          <span
            role="status"
            aria-label="Refreshing timeline"
            className="flex items-center gap-2 text-xs text-muted-foreground"
          >
            <Spinner className="size-3" />
            Refreshing
          </span>
        ) : null}
      </div>

      {timelineQuery.isError ? (
        <Alert variant="destructive" aria-labelledby="memory-timeline-error">
          <TriangleAlert />
          <AlertTitle id="memory-timeline-error">Timeline could not be loaded</AlertTitle>
          <AlertDescription>
            {timelineQuery.error instanceof Error
              ? timelineQuery.error.message
              : "The timeline could not be read."}
          </AlertDescription>
        </Alert>
      ) : timelineQuery.isPending ? (
        // Only the list is a skeleton. The filter bar stays mounted so a filter
        // click never unmounts the control that was just used, or drops focus.
        <div className="space-y-3" data-testid="memory-timeline-skeleton">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      ) : items.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Clock3 />
            </EmptyMedia>
            <EmptyTitle>Nothing observed yet</EmptyTitle>
            <EmptyDescription>
              Episodic memory appears here as integrations and operators record what happened.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ol className="space-y-2.5">
          {items.map((item) => (
            <li key={item.id}>
              <Card className="gap-0 py-0 shadow-sm">
                <CardContent className="space-y-2.5 px-4 py-3.5">
                  <div className="space-y-2">
                    <p className="text-[11px] text-muted-foreground">{formatObserved(item)}</p>
                    <h4 className="text-sm leading-snug font-semibold break-words">{item.title}</h4>
                    <ProvenanceBadges
                      verificationState={item.verificationState as VerificationState}
                      freshness={item.freshness as Freshness}
                      sensitivity={item.sensitivity}
                      origin={item.origin}
                      sourceTier={item.sourceTier}
                      sourceSystem={item.sourceSystem}
                      confidence={item.confidence}
                      embeddingStatus={item.embeddingStatus}
                    />
                  </div>
                  {item.body ? (
                    <p className="line-clamp-2 text-sm text-muted-foreground">{item.body}</p>
                  ) : null}
                  <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-2.5">
                    <ItemChainDialog
                      organizationId={organizationId}
                      item={item}
                      role={role}
                      ceiling={ceiling}
                    />
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      )}

      {timelineQuery.hasNextPage ? (
        <Button
          variant="outline"
          onClick={() => void timelineQuery.fetchNextPage()}
          disabled={timelineQuery.isFetchingNextPage}
          className="self-start"
        >
          {timelineQuery.isFetchingNextPage ? <Spinner className="size-3" /> : null}
          Load older entries
        </Button>
      ) : null}
    </div>
  );
}
