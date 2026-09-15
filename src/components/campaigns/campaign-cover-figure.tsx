"use client";

import { useState, type ReactNode } from "react";

import styles from "@/components/campaigns/campaign-cover-figure.module.css";

/**
 * The shared campaign cover figure: the artwork, or the caller's honest
 * stand-in.
 *
 * One presentational primitive for both the /campaigns portfolio cards and the
 * organization-home summary cards, so the two surfaces cannot drift apart on
 * the parts they genuinely share: contain/cover fit, the bottom-left source
 * chip overlaid on the art (never a plain-text line elsewhere), and the
 * failure fallback. Everything that differs stays with the caller: the sized
 * positioning parent, the fallback markup itself, and — deliberately — the
 * state vocabulary. Portfolio phase badges and home lifecycle tags name
 * different things and are not unified here.
 *
 * A failed URL flips to the fallback (tracked per URL, never cached across a
 * refresh), and an absent source never renders an `img` element.
 */
export function CampaignCoverFigure({
  src,
  alt,
  fit,
  chip = null,
  fallback,
}: Readonly<{
  src: string | null;
  alt: string;
  fit: "cover" | "contain";
  chip?: string | null;
  fallback: ReactNode;
}>) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = src !== null && failedUrl === src;

  if (src === null || failed) return <>{fallback}</>;

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onError={() => setFailedUrl(src)}
        className={`h-full w-full ${fit === "cover" ? "object-cover" : "object-contain"}`}
      />
      {chip !== null ? <span className={styles.chip}>{chip}</span> : null}
    </>
  );
}
