"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

type LivePreviewItem = {
  title: string;
  url: string;
  publisher: string;
  snippet: string;
  retrievedAt: string;
};

type LivePreviewResponse = {
  results: LivePreviewItem[];
  queryCount: number;
  resultCount: number;
  retrievedAt: string;
  correlationId: string;
  liveOnly: boolean;
  disclaimer: string;
};

type SubmittedTerms = {
  topics: string[];
  competitors: string[];
};

function splitTerms(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim().replace(/\s+/g, " "))
    .filter((part) => part.length > 0);
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url;
  }
}

async function fetchLivePreview(input: {
  organizationId: string;
  branchId: string;
  topics: string[];
  competitors: string[];
}): Promise<LivePreviewResponse> {
  const response = await fetch(
    `/api/organizations/${input.organizationId}/market-research/live-preview`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        branchId: input.branchId,
        topics: input.topics,
        competitors: input.competitors,
        idempotencyKey: crypto.randomUUID(),
      }),
    },
  );
  const body = (await response.json().catch(() => null)) as
    | (Partial<LivePreviewResponse> & { error?: { message?: string } })
    | null;
  if (!response.ok) {
    const message =
      body?.error?.message && typeof body.error.message === "string"
        ? body.error.message
        : "Live preview is temporarily unavailable. Try again.";
    throw new Error(message);
  }
  if (!body || !Array.isArray(body.results)) {
    throw new Error("Live preview is temporarily unavailable. Try again.");
  }
  return body as LivePreviewResponse;
}

/**
 * Ephemeral Brave preview. Shows fresh results on screen and discards them:
 * no DB write, no event, no cache. Mounted beside Market Watch for managers
 * only; viewers render nothing.
 */
export function MarketWatchLivePreview({
  organizationId,
  branchId,
  canManage,
}: {
  organizationId: string;
  branchId: string | null;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [topicsText, setTopicsText] = useState("");
  const [competitorsText, setCompetitorsText] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<SubmittedTerms | null>(null);
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: [
      "live-preview",
      organizationId,
      branchId,
      submitted?.topics ?? [],
      submitted?.competitors ?? [],
    ],
    queryFn: () =>
      fetchLivePreview({
        organizationId,
        branchId: branchId ?? "",
        topics: submitted?.topics ?? [],
        competitors: submitted?.competitors ?? [],
      }),
    enabled: open && submitted !== null && branchId !== null,
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
  });

  if (!canManage) return null;

  function submit() {
    const topics = splitTerms(topicsText).slice(0, 3);
    const competitors = splitTerms(competitorsText).slice(0, 2);
    if (branchId === null) {
      setFormError("Choose a location first, then preview fresh results.");
      return;
    }
    if (topics.length + competitors.length < 1) {
      setFormError("Add at least one topic or competitor, separated by commas.");
      return;
    }
    setFormError(null);
    setSubmitted({ topics, competitors });
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Discard on close: the next open starts idle with no cached results.
      setSubmitted(null);
      setFormError(null);
      void queryClient.removeQueries({ queryKey: ["live-preview", organizationId] });
    }
  }

  const results = query.data?.results ?? [];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Search aria-hidden="true" />
        View live results
      </Button>
      <DialogContent
        className="flex max-h-[90vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[620px]"
        aria-describedby="live-preview-description"
      >
        <DialogHeader className="static shrink-0 border-b px-6 py-5 text-left">
          <DialogTitle>Live market preview</DialogTitle>
          <DialogDescription id="live-preview-description">
            Shows fresh results, saves nothing.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="flex flex-col gap-4">
            <Alert>
              <AlertTitle>Live preview — not saved</AlertTitle>
              <AlertDescription>
                Unverified leads, not evidence. Cannot create Insights or Recommendations from
                this view. Closing discards everything.
              </AlertDescription>
            </Alert>

            {branchId === null ? (
              <p className="text-sm text-muted-foreground">
                Choose a location first, then preview fresh results.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="live-preview-topics">Topics, up to 3</Label>
                    <Input
                      id="live-preview-topics"
                      value={topicsText}
                      onChange={(event) => setTopicsText(event.target.value)}
                      placeholder="weekend brunch, seafood offers"
                      maxLength={500}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="live-preview-competitors">Competitors, up to 2</Label>
                    <Input
                      id="live-preview-competitors"
                      value={competitorsText}
                      onChange={(event) => setCompetitorsText(event.target.value)}
                      placeholder="Rival Kitchen"
                      maxLength={400}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Separate names with commas. At most 3 short queries per click.
                </p>
                {formError ? (
                  <p role="alert" className="text-sm text-destructive">
                    {formError}
                  </p>
                ) : null}
                <div>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={submit}
                    disabled={query.isFetching}
                  >
                    <Search aria-hidden="true" />
                    {query.isFetching ? "Checking…" : "Show live results"}
                  </Button>
                </div>
              </div>
            )}

            {submitted === null ? (
              <p className="text-sm text-muted-foreground">
                Shows fresh results, saves nothing.
              </p>
            ) : query.isPending || query.isFetching ? (
              <div className="flex flex-col gap-2" aria-label="Checking fresh results">
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
              </div>
            ) : query.isError ? (
              <Alert variant="destructive">
                <AlertTitle>Preview unavailable</AlertTitle>
                <AlertDescription>
                  {query.error instanceof Error
                    ? query.error.message
                    : "Live preview is temporarily unavailable. Try again."}
                </AlertDescription>
              </Alert>
            ) : results.length === 0 ? (
              <p className="text-sm text-muted-foreground">No results for these terms.</p>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-xs text-muted-foreground">
                  {query.data?.resultCount ?? results.length} fresh{" "}
                  {(query.data?.resultCount ?? results.length) === 1 ? "lead" : "leads"} ·{" "}
                  {query.data?.queryCount ?? 0}{" "}
                  {(query.data?.queryCount ?? 0) === 1 ? "query" : "queries"} · checked{" "}
                  {query.data?.retrievedAt
                    ? new Date(query.data.retrievedAt).toLocaleString("en-AE")
                    : "just now"}
                </p>
                {results.map((item) => (
                  <Card key={item.url} data-testid={`live-preview-result-${item.url}`}>
                    <CardHeader>
                      <CardTitle className="text-base">
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="underline-offset-4 hover:underline"
                        >
                          {item.title}
                        </a>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{item.publisher}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {hostnameOf(item.url)}
                        </span>
                      </div>
                      <p className="text-sm">{item.snippet}</p>
                      <p className="text-xs text-muted-foreground">
                        Seen {new Date(item.retrievedAt).toLocaleString("en-AE")}
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="static mx-0 mb-0 shrink-0 border-t px-6 py-4">
          <span className="mr-auto text-xs text-muted-foreground">
            Live preview — not saved. Unverified leads, not evidence.
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
