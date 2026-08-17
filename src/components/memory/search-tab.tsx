"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Info, Search, TriangleAlert } from "lucide-react";

import {
  memorySearchQueryOptions,
  searchableMemoryTypes,
  type MemorySearchInput,
  type SearchableMemoryType,
} from "@/components/memory/query-options";
import { trustRankGroups } from "@/components/memory/provenance-badges";
import { ResultCard } from "@/components/memory/result-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { MemoryRetrievalResult } from "@/domain/memory/schemas";
import { sensitivities, trustRanks } from "@/domain/memory/types";
import type { Sensitivity, TrustRank } from "@/domain/memory/types";
import type { MemorySnapshot } from "@/modules/memory/application/service";

/**
 * `searchMemorySchema` is strict, so these are the only filters the workspace
 * may offer. The approved design also showed a "verified only" trust filter and
 * a source-system filter; neither exists in the Task 1 search contract, and
 * inventing a request parameter the server would reject — or, worse, silently
 * ignore — would misrepresent what the reader is looking at. Both are therefore
 * omitted rather than faked.
 */
const ageOptions = [
  { value: "any", label: "Any age", maxAgeDays: undefined },
  { value: "7", label: "Last 7 days", maxAgeDays: 7 },
  { value: "30", label: "Last 30 days", maxAgeDays: 30 },
  { value: "90", label: "Last 90 days", maxAgeDays: 90 },
  { value: "365", label: "Last 365 days", maxAgeDays: 365 },
] as const;

const memoryTypeLabels: Readonly<Record<SearchableMemoryType, string>> = {
  structured_fact: "Facts",
  document: "Documents",
  note: "Notes",
  episode: "Episodes",
  decision: "Decisions",
  outcome: "Outcomes",
  lesson: "Lessons",
};

const sensitivityLabels: Readonly<Record<Sensitivity, string>> = {
  public: "Public",
  internal: "Internal",
  confidential: "Confidential",
  customer_content: "Customer content",
};

const degradedCopy: Readonly<Record<string, string>> = {
  EMBEDDING_TIMEOUT: "The embedding service did not answer in time.",
  EMBEDDING_UNAVAILABLE: "The embedding service is unavailable.",
  EMBEDDING_NOT_CONFIGURED: "No embedding provider is configured for this environment.",
};

/** Sensitivity options never exceed the ceiling the server derived for the role. */
function allowedSensitivities(ceiling: Sensitivity): readonly Sensitivity[] {
  return sensitivities.slice(0, sensitivities.indexOf(ceiling) + 1);
}

function groupByTrustRank(
  results: readonly MemoryRetrievalResult[],
): { rank: TrustRank; results: MemoryRetrievalResult[] }[] {
  return trustRanks
    .map((rank) => ({ rank, results: results.filter((result) => result.trustRank === rank) }))
    .filter((group) => group.results.length > 0);
}

export type SearchTabProps = {
  organizationId: string;
  snapshot: MemorySnapshot;
  searchInput: MemorySearchInput | null;
  onSearchInputChange: (input: MemorySearchInput) => void;
};

export function SearchTab({
  organizationId,
  snapshot,
  searchInput,
  onSearchInputChange,
}: SearchTabProps) {
  const [query, setQuery] = useState(searchInput?.query ?? "");
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [age, setAge] = useState<string>("any");
  const [sensitivity, setSensitivity] = useState<string>("default");
  const [history, setHistory] = useState<string[]>([]);
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const awaitingFocus = useRef(false);

  const searchQuery = useQuery(memorySearchQueryOptions({ organizationId, search: searchInput }));
  const response = searchQuery.data;
  const results = response?.results ?? [];
  const hasSearched = searchInput !== null;
  const hasMemory = snapshot.counts.total > 0;

  // Focus moves to the live summary only for a search the operator submitted,
  // never for a background refetch, which must not steal the caret.
  useEffect(() => {
    if (!awaitingFocus.current) return;
    if (searchQuery.isPending || searchQuery.isFetching) return;
    awaitingFocus.current = false;
    summaryRef.current?.focus();
  }, [searchQuery.isPending, searchQuery.isFetching, response, searchQuery.error]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    awaitingFocus.current = true;
    onSearchInputChange({
      query: trimmed,
      memoryTypes: selectedTypes.length > 0 ? (selectedTypes as SearchableMemoryType[]) : undefined,
      sensitivityAllowance: sensitivity === "default" ? undefined : (sensitivity as Sensitivity),
      maxAgeDays: ageOptions.find((option) => option.value === age)?.maxAgeDays,
      includeSuperseded: history.includes("superseded"),
      includeExpired: history.includes("expired"),
      limit: 20,
    });
  };

  const summaryText = searchQuery.isError
    ? "The search could not be completed."
    : !hasSearched
      ? "No search submitted yet."
      : searchQuery.isPending
        ? "Searching business memory…"
        : `${results.length} ${results.length === 1 ? "result" : "results"} for “${searchInput.query}”, grouped by trust rank. ${
            response?.retrievalMode === "hybrid" ? "Hybrid retrieval." : "Keyword-only retrieval."
          }`;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <form onSubmit={submit} className="flex min-w-0 flex-col gap-3">
        <InputGroup className="h-11">
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label="Search business memory"
            placeholder="Ask what this organization knows — pricing, hours, suppliers, decisions…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="text-base"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton type="submit" variant="default" disabled={query.trim().length === 0}>
              Search memory
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>

        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-center gap-2 overflow-x-auto">
            <Label className="shrink-0 text-xs text-muted-foreground">Memory type</Label>
            <ToggleGroup
              type="multiple"
              size="sm"
              variant="outline"
              aria-label="Memory type"
              value={selectedTypes}
              onValueChange={setSelectedTypes}
              className="shrink-0"
            >
              {searchableMemoryTypes.map((memoryType) => (
                <ToggleGroupItem key={memoryType} value={memoryType} className="px-2 text-xs">
                  {memoryTypeLabels[memoryType]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Freshness</Label>
            <Select value={age} onValueChange={setAge}>
              <SelectTrigger size="sm" aria-label="Freshness" className="w-36 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ageOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Sensitivity</Label>
            <Select value={sensitivity} onValueChange={setSensitivity}>
              <SelectTrigger size="sm" aria-label="Sensitivity" className="w-40 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Up to your ceiling</SelectItem>
                {allowedSensitivities(snapshot.ceiling).map((value) => (
                  <SelectItem key={value} value={value}>
                    {sensitivityLabels[value]} and below
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">History</Label>
            <ToggleGroup
              type="multiple"
              size="sm"
              variant="outline"
              aria-label="Include history"
              value={history}
              onValueChange={setHistory}
            >
              <ToggleGroupItem value="superseded" className="px-2 text-xs">
                Superseded
              </ToggleGroupItem>
              <ToggleGroupItem value="expired" className="px-2 text-xs">
                Expired
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
      </form>

      <p
        ref={summaryRef}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        aria-label="Search results"
        className="rounded-md text-xs text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {summaryText}
      </p>

      {response?.degradedReason ? (
        <Alert aria-labelledby="memory-degraded-title">
          <Info />
          <AlertTitle id="memory-degraded-title">Semantic retrieval is unavailable</AlertTitle>
          <AlertDescription>
            {degradedCopy[response.degradedReason] ?? "Semantic retrieval is degraded."} Results
            below came from keyword matching only, so close-meaning matches may be missing. Every
            item shown is real memory, still ranked by trust.
          </AlertDescription>
        </Alert>
      ) : null}

      {searchQuery.isError ? (
        <Alert variant="destructive" aria-labelledby="memory-search-error-title">
          <TriangleAlert />
          <AlertTitle id="memory-search-error-title">Search could not be completed</AlertTitle>
          <AlertDescription>
            {searchQuery.error instanceof Error
              ? searchQuery.error.message
              : "The search could not be completed."}
          </AlertDescription>
        </Alert>
      ) : null}

      {!hasMemory ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Search />
            </EmptyMedia>
            <EmptyTitle>No business memory yet</EmptyTitle>
            <EmptyDescription>
              Nothing has been recorded for this organization. Connect an integration or record a
              note, and verified context will appear here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : !hasSearched ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Search />
            </EmptyMedia>
            <EmptyTitle>Search this organization&apos;s memory</EmptyTitle>
            <EmptyDescription>
              {snapshot.counts.total} items are searchable. Results are grouped by trust rank, so
              verified knowledge always reads above inference.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : searchQuery.isPending ? (
        <div className="space-y-3" data-testid="memory-search-skeleton">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
      ) : searchQuery.isError ? null : results.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Search />
            </EmptyMedia>
            <EmptyTitle>No memory matched this search</EmptyTitle>
            <EmptyDescription>
              This organization has {snapshot.counts.total} items, but none matched these terms and
              filters. Widen the memory types, the age window, or include superseded history.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="space-y-6">
          {groupByTrustRank(results).map((group) => {
            const heading = trustRankGroups[group.rank];
            const HeadingIcon = heading.icon;
            return (
              <section
                key={group.rank}
                role="group"
                aria-label={heading.label}
                className="space-y-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
                    <HeadingIcon aria-hidden="true" className="size-4" />
                    {heading.label}
                  </h3>
                  <span className="text-[11px] text-muted-foreground">
                    {group.results.length} {group.results.length === 1 ? "result" : "results"}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">{heading.description}</p>
                <div className="space-y-2.5">
                  {group.results.map((result, index) => (
                    <ResultCard
                      key={result.itemId ?? `${group.rank}-${index}`}
                      organizationId={organizationId}
                      result={result}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
