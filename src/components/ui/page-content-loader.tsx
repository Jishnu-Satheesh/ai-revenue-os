"use client";

import { Spinner } from "@/components/ui/spinner";

/**
 * The platform's page-content loader.
 *
 * It covers the page-content viewport only: the parent marks itself
 * `relative` and this fills it with a blurry overlay and the centered
 * Spinner. It is deliberately *not* portalled to the body -- a fixed sheet
 * would take over the side-menu dock and the top navbar, which live outside
 * the content area and must stay interactive. Any platform page reuses this
 * while a polled backend build is outstanding; it never stands in for an
 * honest empty state.
 */
export function PageContentLoader({ title, detail }: { title: string; detail?: string }) {
  return (
    <div
      data-slot="page-content-loader"
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="absolute inset-0 z-10 flex items-center justify-center bg-background/70 backdrop-blur-sm"
    >
      <div className="flex max-w-sm flex-col items-center gap-3 p-6 text-center">
        <Spinner className="size-8 text-primary" />
        <p className="text-sm font-medium text-foreground">{title}</p>
        {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
      </div>
    </div>
  );
}
