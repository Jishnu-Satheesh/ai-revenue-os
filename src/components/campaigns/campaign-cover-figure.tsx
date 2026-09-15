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
 * Behavioural defaults serve home (lazy load, broken URL flips to the
 * fallback, intrinsic dimensions threaded through). The portfolio card
 * predates the primitive and keeps its exact prior output — eager, no error
 * flip, caller-owned img classes — by opting out explicitly (see its Artwork).
 * A failed URL flips to the fallback only when `errorFallback` is left on
 * (tracked per URL, never cached across a refresh), and an absent source never
 * renders an `img` element.
 */
export function CampaignCoverFigure({
  src,
  alt,
  fit,
  chip = null,
  fallback,
  imgClassName = null,
  width,
  height,
  loading = "lazy",
  errorFallback = true,
}: Readonly<{
  src: string | null;
  alt: string;
  fit: "cover" | "contain";
  chip?: string | null;
  fallback: ReactNode;
  /** Caller-owned img classes (sizing stays with the caller's parent). */
  imgClassName?: string | null;
  /** Intrinsic dimensions, threaded to the img when the caller knows them. */
  width?: number;
  height?: number;
  loading?: "lazy" | "eager";
  /** When false, a broken URL keeps rendering `<img>` — no fallback flip. */
  errorFallback?: boolean;
}>) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = errorFallback && src !== null && failedUrl === src;

  if (src === null || failed) return <>{fallback}</>;

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading={loading === "lazy" ? "lazy" : undefined}
        onError={errorFallback ? () => setFailedUrl(src) : undefined}
        className={
          imgClassName ?? `h-full w-full ${fit === "cover" ? "object-cover" : "object-contain"}`
        }
      />
      {chip !== null ? <span className={styles.chip}>{chip}</span> : null}
    </>
  );
}
