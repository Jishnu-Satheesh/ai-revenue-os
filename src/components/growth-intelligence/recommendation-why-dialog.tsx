"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function RecommendationWhyDialog({
  title,
  detail,
  scopeLabel,
  evidenceText,
  limitation,
  supportedActions,
  channelHref,
  canManage,
  citationCount,
}: {
  title: string;
  detail: string;
  scopeLabel: string;
  evidenceText: string;
  limitation: string | null;
  supportedActions: readonly string[];
  channelHref: string | null;
  /** Managers answer in the channel surface; viewers open it read-only. */
  canManage: boolean;
  /** Stored findings the narration cited; zero means the row cited none. */
  citationCount: number;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto gap-1 px-0 text-[13px] font-bold text-primary"
        >
          Why this?
          <ArrowUpRight aria-hidden="true" className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Why this recommendation?</DialogTitle>
          <DialogDescription>
            The stored evidence behind this advice. No financial outcome has been measured here.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 text-sm leading-relaxed">
          <div>
            <p className="text-base font-bold">{title}</p>
            <p className="mt-2 text-muted-foreground">{detail}</p>
          </div>
          <dl className="flex flex-col gap-3">
            <div>
              <dt className="font-semibold">Scope</dt>
              <dd className="text-muted-foreground">{scopeLabel}</dd>
            </div>
            <div>
              <dt className="font-semibold">Evidence</dt>
              <dd className="text-muted-foreground">
                {evidenceText} · cites {citationCount} stored finding
                {citationCount === 1 ? "" : "s"}
              </dd>
            </div>
            <div>
              <dt className="font-semibold">Limitation</dt>
              <dd className="text-muted-foreground">
                {limitation ??
                  "This advice is a next step to investigate. No financial outcome has been measured."}
              </dd>
            </div>
            {supportedActions.length > 0 ? (
              <div>
                <dt className="font-semibold">What to do next</dt>
                <dd>
                  <ul className="mt-1 flex flex-col gap-1 text-muted-foreground">
                    {supportedActions.map((action) => (
                      <li key={action} className="flex gap-1.5">
                        <span aria-hidden="true">→</span>
                        <span>{action}</span>
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            ) : null}
          </dl>
          {channelHref ? (
            <Link
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              href={channelHref}
            >
              {canManage ? "Answer in the channel workspace" : "View in the channel workspace"}
            </Link>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
