"use client";

import { ImageOff, Loader2, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";

import {
  creativeHistoryUploadStateLabel,
  creativeTypeLabel,
} from "@/components/assets/asset-vocabulary";
import type { CreativeHistoryItemView } from "@/components/assets/asset-query-options";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * The grid of past designs.
 *
 * A design's card renders exactly one of three image states, and they are
 * never allowed to look alike:
 *
 *   - a real preview, `object-fit: contain`, upright, label outside the image;
 *   - "No preview available" when `previewUrl` is null — the server either
 *     has nothing to sign or signing itself failed, and either way there is
 *     nothing to retry by reloading the image;
 *   - "Preview expired" when a `previewUrl` was issued but the `<img>` failed
 *     to load. Signed preview URLs are bounded-lifetime by design (C09), so a
 *     load failure on a URL the server *did* issue is read as the signature
 *     having expired while this tab sat open, not as a broken image. Reload
 *     re-fetches the list, which mints a fresh signed URL.
 *
 * A rejected design stays in the grid with its verdict visible, never
 * removed — rejection is still teaching a future generation what to avoid.
 */

type CreativeHistoryGridProps = {
  items: readonly CreativeHistoryItemView[];
  onSelect: (itemId: string) => void;
  selectedItemId?: string | null;
  onReloadPreviews: () => void;
  emptyState: ReactNode;
  /** The organization's configured timezone, per the shared presentation rules. */
  timeZone: string;
};

function VerdictBadge({ item }: { item: CreativeHistoryItemView }) {
  const review = item.currentVersion?.review ?? null;
  if (review === null) {
    return (
      <Badge variant="outline" className="shrink-0 text-muted-foreground">
        Unreviewed
      </Badge>
    );
  }
  return (
    <Badge variant={review.verdict === "approved" ? "default" : "secondary"} className="shrink-0">
      {review.verdict === "approved" ? "Approved" : "Rejected"}
    </Badge>
  );
}

function PreviewImage({ item, onReloadPreviews }: { item: CreativeHistoryItemView; onReloadPreviews: () => void }) {
  const [expired, setExpired] = useState(false);
  const previewUrl = item.currentVersion?.previewUrl ?? null;

  if (item.currentVersion === null) {
    return (
      <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-md bg-muted text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
        <span className="text-xs">{creativeHistoryUploadStateLabel(item.uploadState)}</span>
      </div>
    );
  }

  if (previewUrl === null) {
    return (
      <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-md bg-muted text-muted-foreground">
        <ImageOff className="size-6" />
        <span className="text-xs">No preview available</span>
      </div>
    );
  }

  if (expired) {
    return (
      <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 rounded-md bg-muted text-muted-foreground">
        <ImageOff className="size-6" />
        <span className="text-xs">Preview expired</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={(event) => {
            event.stopPropagation();
            setExpired(false);
            onReloadPreviews();
          }}
        >
          <RotateCcw className="size-3.5" />
          Reload
        </Button>
      </div>
    );
  }

  return (
    <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-md bg-muted">
      {/* eslint-disable-next-line @next/next/no-img-element -- a signed, time-boxed URL is not a static asset Next's optimizer should cache. */}
      <img
        src={previewUrl}
        alt={item.label}
        className="size-full object-contain"
        onError={() => setExpired(true)}
      />
    </div>
  );
}

export function CreativeHistoryGrid({
  items,
  onSelect,
  selectedItemId = null,
  onReloadPreviews,
  emptyState,
  timeZone,
}: CreativeHistoryGridProps) {
  if (items.length === 0) {
    return <>{emptyState}</>;
  }

  return (
    <div
      role="grid"
      aria-label="Creative History designs"
      className="grid gap-4"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}
    >
      {items.map((item) => {
        const version = item.currentVersion;
        const dateLabel = version?.finalizedAt ?? item.createdAt;
        return (
          <Card
            key={item.itemId}
            role="gridcell"
            className={
              "overflow-hidden p-0 " + (selectedItemId === item.itemId ? "ring-2 ring-primary" : "")
            }
          >
            {/*
              A `<div role="button">`, not a real `<button>`: the Reload
              control inside `PreviewImage` is itself a button, and a button
              nested inside another button is invalid HTML whose computed
              accessible name also swallows the inner one's text — which is
              exactly the failure this comment is here to prevent a future
              edit from reintroducing.
            */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => onSelect(item.itemId)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(item.itemId);
                }
              }}
              aria-pressed={selectedItemId === item.itemId}
              aria-label={item.label}
              className="block w-full cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <CardContent className="flex flex-col gap-2 p-3">
                <PreviewImage item={item} onReloadPreviews={onReloadPreviews} />
                <div className="flex items-start justify-between gap-2">
                  <span dir="auto" className="truncate text-sm font-medium leading-tight">
                    {item.label}
                  </span>
                  <VerdictBadge item={item} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {creativeTypeLabel(item.creativeType)}
                  {version ? ` · v${version.version}` : ""}
                  {dateLabel
                    ? ` · ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone }).format(new Date(dateLabel))}`
                    : ""}
                </p>
                {item.archivedAt !== null ? (
                  <Badge variant="outline" className="w-fit text-muted-foreground">
                    Archived
                  </Badge>
                ) : null}
              </CardContent>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
