"use client";

import { useState } from "react";
import { BookOpenText } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import type { MarketWatchSignalSource } from "@/modules/growth-intelligence/application/market-watch";

function formatInstant(value: string | null): string {
  if (!value) return "Not recorded";
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "Not recorded";
  return `${new Date(parsed).toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

export function SourceEvidenceDrawer({ sources }: { sources: MarketWatchSignalSource[] }) {
  const [open, setOpen] = useState(false);
  if (sources.length === 0) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <BookOpenText aria-hidden="true" />
          View sources ({sources.length})
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Source evidence</DialogTitle>
          <DialogDescription>
            Citations only. Full source pages are never stored or rendered here.
          </DialogDescription>
        </DialogHeader>
        <Separator />
        <ul className="flex max-h-96 flex-col gap-4 overflow-y-auto">
          {sources.map((source, index) => (
            <li
              key={`${source.url}::${source.publisher ?? ""}::${source.retrievedAt}::${index}`}
              className="flex flex-col gap-1 text-sm"
            >
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium break-all underline underline-offset-4"
              >
                {source.publisher ?? source.url}
              </a>
              <span className="text-muted-foreground">
                {source.sourceClass} · Retrieved {formatInstant(source.retrievedAt)}
              </span>
              <span className="text-muted-foreground">
                Observed {formatInstant(source.observedAt)} · Published{" "}
                {formatInstant(source.publishedAt)}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
