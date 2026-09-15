"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Images } from "lucide-react";

import { HomePreviewImage } from "@/components/organizations/home/home-preview-image";
import { formatInstant } from "@/components/organizations/home/home-dates";
import { HomeRefreshButton } from "@/components/organizations/home/home-refresh-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import type {
  HomeAsset,
  HomeSection,
} from "@/modules/organizations/application/home-types";
import styles from "@/components/organizations/home/organization-home.module.css";

/**
 * Creative shelf: up to four thumbnail buttons, each named by title, source
 * kind and review state, opening one read-only dialog. Only the selected
 * composite asset id is stored; the selected item is derived from current
 * props on every render, so refreshed signed URLs replace expired ones and a
 * selected id that vanishes on refresh closes the dialog without throwing.
 * Closing returns focus to the thumbnail that opened it. An image-only
 * failure keeps every label and the source link.
 */
export function HomeAssets({
  organizationId,
  organizationName,
  timeZone,
  section,
  partial,
}: Readonly<{
  organizationId: string;
  organizationName: string;
  timeZone: string;
  section: HomeSection<readonly HomeAsset[]>;
  partial: boolean;
}>) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());

  const gallery = section.status === "ready" ? section.data.slice(0, 4) : [];
  const selected =
    section.status === "ready"
      ? (section.data.find((item) => item.id === selectedId) ?? null)
      : null;
  // `dialogOpen` derives from current props every render: a refresh that
  // drops the selected record closes the dialog with no extra state to reset,
  // and a refreshed signed URL for the same id renders immediately.
  const dialogOpen = open && selected !== null;

  if (section.status === "disabled") return null;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next && selectedId !== null) {
      // Radix unmounts before focus can return; re-focus after close.
      const trigger = triggerRefs.current.get(selectedId);
      window.setTimeout(() => trigger?.focus(), 0);
    }
  }

  const libraryHref = `/organizations/${organizationId}/assets`;

  return (
    <section id="home-library" aria-label="Your creative library" className={styles.library}>
      <div className={styles.sectionHead}>
        <div>
          <h2 className={styles.sectionTitle}>Your creative library</h2>
          <p className={styles.caption}>A little of what makes your business yours.</p>
        </div>
        <Button asChild variant="link" size="sm">
          <Link href={libraryHref}>
            Asset Library
            <ArrowRight aria-hidden="true" data-icon="inline-end" />
          </Link>
        </Button>
      </div>

      {section.status === "failed" ? (
        <Alert>
          <Images aria-hidden="true" />
          <AlertTitle>Recent work could not be loaded</AlertTitle>
          <AlertDescription>
            What could be read elsewhere on this page is still current.
          </AlertDescription>
          <div className="mt-3">
            <HomeRefreshButton label="Retry" />
          </div>
        </Alert>
      ) : gallery.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Images aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No saved work yet</EmptyTitle>
            <EmptyDescription>
              Finished renders and brand references will appear here.{" "}
              <Link href={libraryHref} className={styles.inlineLink}>
                Open the Asset Library
              </Link>{" "}
              to add some.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          {partial ? (
            <Alert className={styles.warning}>
              <Images aria-hidden="true" />
              <AlertTitle>Some recent work could not be loaded</AlertTitle>
              <AlertDescription>
                What could be read is shown below. Retry refreshes the whole page from the
                server.
              </AlertDescription>
              <div className="mt-3">
                <HomeRefreshButton label="Retry" />
              </div>
            </Alert>
          ) : null}
          <div className={styles.galleryGrid}>
            {gallery.map((item) => (
              <button
                key={item.id}
                ref={(node) => {
                  if (node) triggerRefs.current.set(item.id, node);
                  else triggerRefs.current.delete(item.id);
                }}
                type="button"
                aria-label={`${item.label}, ${item.sourceLabel}, ${item.reviewLabel}`}
                aria-haspopup="dialog"
                onClick={() => {
                  setSelectedId(item.id);
                  setOpen(true);
                }}
                className={styles.thumb}
              >
                <span className={styles.thumbImage}>
                  <HomePreviewImage
                    image={item.image}
                    frameClassName={styles.coverFallback}
                  />
                </span>
                <span className={styles.thumbMeta}>
                  <span dir="auto" className={styles.thumbLabel}>
                    {item.label}
                  </span>
                  <span className={styles.thumbSub}>
                    {item.sourceLabel} · {item.reviewLabel}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={handleOpenChange}>
        <DialogContent className={styles.dialogContent}>
          {selected !== null ? (
            <>
              <DialogHeader>
                <DialogTitle dir="auto">{selected.label}</DialogTitle>
                <DialogDescription>
                  {selected.sourceLabel} · {selected.reviewLabel}
                </DialogDescription>
              </DialogHeader>
              <div className={styles.dialogGrid}>
                <div className={styles.dialogImage}>
                  <HomePreviewImage
                    image={selected.image}
                    frameClassName={styles.coverFallback}
                  />
                </div>
                <div className={styles.dialogDetails}>
                  <p className={styles.cardText}>
                    Saved for <span dir="auto">{organizationName}</span>
                  </p>
                  <p className={styles.meta}>
                    Recorded{" "}
                    <time dateTime={selected.recordedAt}>
                      {formatInstant(selected.recordedAt, timeZone)}
                    </time>
                  </p>
                  <p className={styles.meta}>Source: {selected.sourceLabel}</p>
                  <p className={styles.meta}>Review: {selected.reviewLabel}</p>
                  <Button asChild className={styles.dialogSourceButton}>
                    <Link href={selected.sourceHref}>
                      Open source
                      <ArrowRight aria-hidden="true" data-icon="inline-end" />
                    </Link>
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
