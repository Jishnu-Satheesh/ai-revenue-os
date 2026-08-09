"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Clock3, Eye, ScrollText, Search, ShieldCheck } from "lucide-react";

import {
  memorySearchQueryOptions,
  memorySnapshotQueryOptions,
  type MemorySearchInput,
} from "@/components/memory/query-options";
import { LessonsTab } from "@/components/memory/lessons-tab";
import { NoteDialog } from "@/components/memory/note-dialog";
import { ReviewTab } from "@/components/memory/review-tab";
import { SearchTab } from "@/components/memory/search-tab";
import { TimelineTab } from "@/components/memory/timeline-tab";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { hasMemoryPermission } from "@/domain/memory/permissions";
import type { Sensitivity } from "@/domain/memory/types";
import type { OrganizationRole } from "@/domain/organizations/types";
import type { MemorySnapshot } from "@/modules/memory/application/service";

export type MemoryWorkspaceClientProps = {
  organizationId: string;
  organizationName: string;
  role: OrganizationRole;
  initialSnapshot: MemorySnapshot;
  /**
   * When the server payload was read. Tests and streamed navigations use it to
   * decide whether the first client render should refetch.
   */
  initialDataUpdatedAt?: number;
};

const sensitivityLabels: Readonly<Record<Sensitivity, string>> = {
  public: "Public",
  internal: "Internal",
  confidential: "Confidential",
  customer_content: "Customer content",
};

function SnapshotFact({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2.5 border-l pl-4 first:border-l-0 first:pl-0">
      <p className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
        {label}
      </p>
      <span className="flex items-baseline gap-1.5">
        <span className="text-sm font-semibold">{value}</span>
        {detail ? <span className="text-[10px] text-muted-foreground">{detail}</span> : null}
      </span>
    </div>
  );
}

/**
 * The compact operator console. Search is the default and dominant view; the
 * slim row above it carries only counts the snapshot actually returned, so the
 * workspace never implies measurement it has not made.
 */
export function MemoryWorkspaceClient({
  organizationId,
  organizationName,
  role,
  initialSnapshot,
  initialDataUpdatedAt,
}: MemoryWorkspaceClientProps) {
  const [searchInput, setSearchInput] = useState<MemorySearchInput | null>(null);

  const snapshotQuery = useQuery(
    memorySnapshotQueryOptions({
      organizationId,
      initialData: initialSnapshot,
      initialDataUpdatedAt,
    }),
  );
  // Subscribing to the same key the Search view uses lets the header report
  // real retrieval health without issuing a second request.
  const searchQuery = useQuery(memorySearchQueryOptions({ organizationId, search: searchInput }));

  // Never blank data that is already on screen: a refetch only adds a status
  // line, and the last successful payload keeps rendering underneath it.
  const snapshot = snapshotQuery.data ?? initialSnapshot;
  const isRefreshing = snapshotQuery.isFetching || searchQuery.isFetching;
  const canWrite = hasMemoryPermission(role, "memory.write");

  const retrievalHealth = !searchQuery.data
    ? "Not measured yet this session"
    : searchQuery.data.retrievalMode === "hybrid"
      ? "Hybrid (semantic + keyword)"
      : "Keyword only";

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col gap-4">
      <div aria-live="polite" className="flex h-5 items-center gap-2 text-xs text-muted-foreground">
        {isRefreshing ? (
          <span role="status" aria-label="Refreshing memory data" className="flex items-center gap-2">
            <Spinner className="size-3" />
            Refreshing memory data
          </span>
        ) : null}
      </div>

      <Card className="flex w-full min-w-0 flex-row items-center gap-4 overflow-x-auto px-4 py-3">
        <SnapshotFact label="Items" value={String(snapshot.counts.total)} detail="searchable" />
        <SnapshotFact
          label="Review"
          value={String(snapshot.counts.reviewQueueDepth)}
          detail="pending"
        />
        <SnapshotFact
          label="Embedding"
          value={
            snapshot.counts.embeddingBacklog === 0
              ? "Up to date"
              : String(snapshot.counts.embeddingBacklog)
          }
          detail={snapshot.counts.embeddingBacklog === 0 ? undefined : "awaiting embedding"}
        />
        <SnapshotFact label="Your ceiling" value={sensitivityLabels[snapshot.ceiling]} />
        <SnapshotFact label="Retrieval" value={retrievalHealth} />
      </Card>

      {canWrite ? (
        <div className="flex justify-end">
          <NoteDialog organizationId={organizationId} ceiling={snapshot.ceiling} />
        </div>
      ) : (
        <Alert>
          <Eye />
          <AlertTitle>Read-only access</AlertTitle>
          <AlertDescription>
            You can search and inspect {organizationName}&apos;s memory. Recording, verifying, and
            superseding memory require an operator role.
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="search" className="min-h-0 min-w-0 flex-1">
        {/* The tab strip scrolls inside its own container so a narrow viewport
            never widens the document. */}
        <TabsList
          variant="line"
          aria-label="Business Memory views"
          className="w-full max-w-full overflow-x-auto sm:w-fit"
        >
          <TabsTrigger value="search">
            <Search data-icon="inline-start" aria-hidden="true" />
            Search
          </TabsTrigger>
          <TabsTrigger value="timeline">
            <Clock3 data-icon="inline-start" aria-hidden="true" />
            Timeline
          </TabsTrigger>
          <TabsTrigger value="lessons">
            <ScrollText data-icon="inline-start" aria-hidden="true" />
            Lessons
          </TabsTrigger>
          <TabsTrigger value="review">
            <ShieldCheck data-icon="inline-start" aria-hidden="true" />
            Review
            {snapshot.counts.reviewQueueDepth > 0 ? (
              <Badge variant="secondary" className="ml-1 text-[10px]">
                {snapshot.counts.reviewQueueDepth}
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>

        {/* Kept mounted so the composed query and its filters survive a trip to
            another tab; an unmounted Search would silently reset filters while
            its results stayed cached, misstating what produced them. */}
        <TabsContent value="search" forceMount className="min-h-0 min-w-0 data-[state=inactive]:hidden">
          <SearchTab
            organizationId={organizationId}
            snapshot={snapshot}
            searchInput={searchInput}
            onSearchInputChange={setSearchInput}
          />
        </TabsContent>
        <TabsContent value="timeline" className="min-h-0 min-w-0">
          <TimelineTab organizationId={organizationId} role={role} ceiling={snapshot.ceiling} />
        </TabsContent>
        <TabsContent value="lessons" className="min-h-0 min-w-0">
          <LessonsTab organizationId={organizationId} role={role} ceiling={snapshot.ceiling} />
        </TabsContent>
        <TabsContent value="review" className="min-h-0 min-w-0">
          <ReviewTab
            organizationId={organizationId}
            reviewQueue={snapshot.reviewQueue}
            role={role}
            ceiling={snapshot.ceiling}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
