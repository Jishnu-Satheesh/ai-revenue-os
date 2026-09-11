"use client";

import { useState } from "react";
import { Images } from "lucide-react";

import type { HomeImage } from "@/modules/organizations/application/home-types";
import styles from "@/components/organizations/home/organization-home.module.css";

/**
 * One contained private preview with a local-only failure fallback.
 *
 * The failed URL is tracked (not a boolean) so a refreshed signed URL for the
 * same record renders immediately: callers derive the item from current props
 * and this wrapper never caches a URL in state. An absent URL never renders
 * an `img` element, and no external placeholder is used.
 */
export function HomePreviewImage({
  image,
  frameClassName,
  imgClassName,
}: Readonly<{
  image: HomeImage | null;
  frameClassName?: string;
  imgClassName?: string;
}>) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = image !== null && failedUrl === image.url;

  if (image === null || failed) {
    return (
      <div className={frameClassName ?? styles.coverFallback} role="presentation">
        <Images aria-hidden="true" className="size-5" />
        <span className={styles.fallbackLabel}>Preview unavailable</span>
      </div>
    );
  }

  return (
    // A server-minted short-lived signed URL for a private bucket: routing it
    // through an optimizing CDN cache is banned by the home data contract, so
    // this stays a plain contained img like the existing campaign previews.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={image.url}
      alt={image.alt}
      width={image.width}
      height={image.height}
      loading="lazy"
      onError={() => setFailedUrl(image.url)}
      className={imgClassName}
    />
  );
}
