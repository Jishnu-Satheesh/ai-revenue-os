"use client";

import { useState, type ReactNode } from "react";

/**
 * Shared presentational preview figure for asset thumbnails.
 *
 * Two surfaces show the same thing — a contained server-minted signed preview
 * with a neutral "unavailable" fallback — inside different frames: the home
 * gallery tile (fixed band heights in `organization-home.module.css`) and the
 * Asset Library card (an aspect-ratio Tailwind frame). The figure owns only
 * the img-or-fallback branch and the load-failure tracking; the frame, the
 * fallback markup, the title/sub rows, and every behavior (inspector select,
 * reload-expired, archive badges, review controls, read-only dialog) stay
 * per-surface, so neither surface leaks into the other.
 *
 * Failure tracking is per URL by default so a refreshed signed URL for the
 * same record renders immediately (the home gallery case). The library keeps
 * its exact prior sticky-boolean behavior by passing
 * `forgetFailureOnSrcChange={false}`, which is why the donor grid renders its
 * byte-identical prior DOM through this primitive.
 */
export function AssetThumbFigure({
  src,
  alt,
  width,
  height,
  loading = "lazy",
  imgClassName,
  fallback,
  forgetFailureOnSrcChange = true,
}: Readonly<{
  /** Signed preview URL, or null when the server minted nothing. Never an img then. */
  src: string | null;
  alt: string;
  width?: number;
  height?: number;
  /** Default lazy; eager omits the attribute entirely. */
  loading?: "lazy" | "eager";
  imgClassName?: string;
  /** Caller-owned fallback markup, rendered verbatim when there is no usable src. */
  fallback: ReactNode;
  /**
   * True (default) forgets a failure once src changes; false keeps the
   * fallback until unmount, matching the library's prior sticky flag.
   */
  forgetFailureOnSrcChange?: boolean;
}>) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed =
    src !== null &&
    failedSrc !== null &&
    (forgetFailureOnSrcChange ? failedSrc === src : true);

  if (src === null || failed) {
    return <>{fallback}</>;
  }

  return (
    // A server-minted short-lived signed URL for a private bucket: routing it
    // through an optimizing CDN cache would cache a time-boxed grant, so this
    // stays a plain contained img on both surfaces.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading={loading === "eager" ? undefined : "lazy"}
      onError={() => setFailedSrc(src)}
      className={imgClassName}
    />
  );
}
