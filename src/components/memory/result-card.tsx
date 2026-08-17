"use client";

import { EyeOff, Link2 } from "lucide-react";

import { ItemChainDialog } from "@/components/memory/item-chain-dialog";
import { ProvenanceBadges } from "@/components/memory/provenance-badges";
import { Card, CardContent } from "@/components/ui/card";
import type { MemoryRetrievalResult } from "@/domain/memory/schemas";

/**
 * One retrieval result, rendered so that what the platform knows and how well
 * it knows it are readable together. A result whose body the caller's ceiling
 * withholds still appears: hiding it would tell the reader nothing, while
 * labelling it tells them memory exists that they may not read.
 */
export function ResultCard({
  organizationId,
  result,
}: {
  organizationId: string;
  result: MemoryRetrievalResult;
}) {
  return (
    <Card className="gap-0 py-0 shadow-sm">
      <CardContent className="space-y-2.5 px-4 py-3.5">
        <div className="space-y-2">
          <h4 className="text-sm leading-snug font-semibold break-words">{result.title}</h4>
          <ProvenanceBadges
            verificationState={result.provenance.verificationState}
            freshness={result.freshness}
            sensitivity={result.sensitivity}
            origin={result.provenance.origin}
            sourceTier={result.provenance.sourceTier}
            sourceSystem={result.provenance.sourceSystem}
            confidence={result.provenance.confidence}
          />
        </div>

        {result.body ? (
          <p className="line-clamp-3 text-sm leading-normal text-muted-foreground">{result.body}</p>
        ) : (
          <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
            <EyeOff aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span>Body withheld at your access level. Provenance below stays auditable.</span>
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2.5">
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            <Link2 aria-hidden="true" className="size-3 shrink-0" />
            <span className="truncate">
              {result.provenance.sourceReference
                ? `Ref: ${result.provenance.sourceReference}`
                : "No source reference recorded"}
            </span>
          </span>
          {result.itemId ? (
            <ItemChainDialog organizationId={organizationId} result={result} />
          ) : (
            // A structured fact is projected from the Digital Twin rather than
            // stored as a memory item, so there is no chain to inspect.
            <span className="text-[11px] text-muted-foreground">
              Projected fact — no stored item to inspect
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
