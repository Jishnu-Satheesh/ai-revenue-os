"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowRight, GitBranch, Link2, ScrollText, TriangleAlert } from "lucide-react";

import { memoryItemQueryOptions } from "@/components/memory/query-options";
import {
  ProvenanceBadges,
  StatusLabel,
  trustRankGroups,
} from "@/components/memory/provenance-badges";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import type { MemoryRetrievalResult } from "@/domain/memory/schemas";
import type { MemoryLinkRelation } from "@/domain/memory/types";
import { cn } from "@/lib/utils";
import type { MemoryItemDetail, MemoryItemView } from "@/modules/memory/application/service";

const relationLabels: Readonly<Record<MemoryLinkRelation, string>> = {
  derived_from: "Derived from",
  supports: "Supports",
  contradicts: "Contradicts",
  explains: "Explains",
};

function formatTimestamp(value?: string): string {
  if (!value) return "Not recorded";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "Not recorded";
  // UTC keeps the audit trail unambiguous; the organization's display timezone
  // is applied by the shared formatter work tracked outside this slice.
  return `${new Date(parsed).toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border p-2.5">
      <dt className="text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-xs font-medium">{value}</dd>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
      {children}
    </h3>
  );
}

type ChainPosition = "earlier" | "this" | "later";

const chainPositionLabels: Readonly<Record<ChainPosition, string>> = {
  earlier: "Earlier version",
  this: "The item you are inspecting",
  later: "Later version",
};

/**
 * `getItemDetail` returns the supersession chain *around* the item without the
 * item in it, ordered predecessors-then-successors. Walking `supersededById`
 * forward from the item identifies which entries came after it, so the rendered
 * timeline can place the inspected version in its real position instead of
 * labelling every neighbour a replacement.
 */
function positionChain(
  detail: MemoryItemDetail,
): { entry: MemoryItemView; position: ChainPosition }[] {
  const byId = new Map(detail.chain.map((entry) => [entry.id, entry]));
  const laterIds = new Set<string>();
  let cursor = detail.item.supersededById;
  while (cursor && byId.has(cursor) && !laterIds.has(cursor)) {
    laterIds.add(cursor);
    cursor = byId.get(cursor)?.supersededById;
  }

  return [
    ...detail.chain
      .filter((entry) => !laterIds.has(entry.id))
      .map((entry) => ({ entry, position: "earlier" as const })),
    { entry: detail.item, position: "this" as const },
    ...detail.chain
      .filter((entry) => laterIds.has(entry.id))
      .map((entry) => ({ entry, position: "later" as const })),
  ];
}

function ChainEntry({
  entry,
  position,
}: {
  entry: MemoryItemView;
  position: ChainPosition;
}) {
  return (
    <li className="relative pl-6">
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-1.5 left-0 size-2 rounded-full border-2 border-background",
          position === "this" ? "bg-foreground" : "bg-muted-foreground",
        )}
      />
      <p className="text-xs font-medium">{entry.title}</p>
      <p className="text-[11px] text-muted-foreground">
        {chainPositionLabels[position]} · created {formatTimestamp(entry.createdAt)}
      </p>
      {entry.supersessionReason ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Reason: {entry.supersessionReason}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Evidence inspection is a modal `Dialog`, never a persistent pane: it is a
 * focused read of one item's provenance that ends by returning the operator to
 * exactly the result they were reading. Radix owns focus trapping and
 * restoration, so the trigger must stay the real focusable button.
 */
export function ItemChainDialog({
  organizationId,
  result,
}: {
  organizationId: string;
  result: MemoryRetrievalResult;
}) {
  const [open, setOpen] = useState(false);
  // The detail read is privileged and RLS-bound. It is issued only once the
  // operator has actually asked to inspect this item.
  const detailQuery = useQuery(
    memoryItemQueryOptions({ organizationId, itemId: result.itemId, enabled: open }),
  );
  const detail = detailQuery.data;
  const trust = trustRankGroups[result.trustRank];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs font-semibold">
          Inspect chain
          <ArrowRight aria-hidden="true" className="size-3" />
        </Button>
      </DialogTrigger>
      {/* `flex` overrides the primitive's grid so the body scrolls inside the
          dialog rather than growing it past the viewport on a small screen. */}
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 py-4 text-left">
          <DialogTitle className="text-base">{result.title}</DialogTitle>
          <DialogDescription>
            Evidence inspection · {trust.label}. {trust.description}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <section className="space-y-2">
            <SectionHeading>Provenance</SectionHeading>
            <ProvenanceBadges
              verificationState={result.provenance.verificationState}
              freshness={result.freshness}
              sensitivity={result.sensitivity}
              origin={result.provenance.origin}
              sourceTier={result.provenance.sourceTier}
              sourceSystem={result.provenance.sourceSystem}
              confidence={result.provenance.confidence}
              embeddingStatus={detail?.item.embeddingStatus}
            />
            {detailQuery.isPending ? (
              <p className="text-[11px] text-muted-foreground">Reading embedding state…</p>
            ) : null}
          </section>

          <section className="space-y-2">
            <SectionHeading>Source reference</SectionHeading>
            <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <DetailRow label="Reference" value={result.provenance.sourceReference ?? "None recorded"} />
              <DetailRow label="Memory type" value={result.memoryType} />
              <DetailRow label="Observed" value={formatTimestamp(result.observedAt)} />
              <DetailRow label="Verified" value={formatTimestamp(result.provenance.verifiedAt)} />
            </dl>
          </section>

          {result.body ? (
            <section className="space-y-2">
              <SectionHeading>Recorded content</SectionHeading>
              <p className="rounded-md border bg-muted/40 p-3 text-sm leading-relaxed">
                {result.body}
              </p>
            </section>
          ) : (
            <Alert>
              <TriangleAlert />
              <AlertTitle>Content withheld</AlertTitle>
              <AlertDescription>
                This item&apos;s body is withheld at your access level. Provenance is still shown so
                the record remains auditable.
              </AlertDescription>
            </Alert>
          )}

          <Separator />

          <section className="space-y-2">
            <SectionHeading>Evidence links</SectionHeading>
            {detailQuery.isPending ? (
              <Skeleton className="h-12 w-full rounded-md" />
            ) : detail && detail.links.length > 0 ? (
              <ul className="space-y-1.5">
                {detail.links.map((link) => (
                  <li key={link.id} className="flex items-start gap-2 text-xs">
                    <Link2 aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
                    <span className="min-w-0">
                      <span className="font-medium">{relationLabels[link.relation]}</span>{" "}
                      <span className="text-muted-foreground">
                        ({link.direction === "from" ? "outgoing" : "incoming"})
                      </span>{" "}
                      <code className="break-all text-[11px]">{link.relatedItemId}</code>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                No evidence links are recorded for this item.
              </p>
            )}
          </section>

          <section className="space-y-2">
            <SectionHeading>Supersession chain</SectionHeading>
            {detailQuery.isPending ? (
              <Skeleton className="h-12 w-full rounded-md" />
            ) : detail && detail.chain.length > 0 ? (
              <ol aria-label="Supersession chain" className="space-y-3 border-l pl-2">
                {positionChain(detail).map(({ entry, position }) => (
                  <ChainEntry key={entry.id} entry={entry} position={position} />
                ))}
              </ol>
            ) : (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <GitBranch aria-hidden="true" className="size-3" />
                This item has never been superseded.
              </p>
            )}
          </section>

          {detailQuery.isError ? (
            <Alert variant="destructive" aria-labelledby="memory-detail-error-title">
              <TriangleAlert />
              <AlertTitle id="memory-detail-error-title">Details could not be loaded</AlertTitle>
              <AlertDescription>
                {detailQuery.error instanceof Error
                  ? detailQuery.error.message
                  : "The item detail could not be read."}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>

        <DialogFooter className="border-t px-5 py-3 sm:justify-between">
          <StatusLabel label={`Trust rank ${result.trustRank}`} icon={ScrollText} />
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            Close inspection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
