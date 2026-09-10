"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Watches the aggregate build status for the picked range while the loader
 * is up. Any settled verdict -- figures ready or nothing left to wait for --
 * re-reads the page from the server, which is where the card (or the honest
 * note) is decided. A dropped poll is retried, never mistaken for an answer.
 */
export function PerformanceBuildWatcher({
  organizationId,
  from,
  to,
  channelIds,
  pollMs = 2000,
}: {
  organizationId: string;
  from: string;
  to: string;
  channelIds: readonly string[];
  pollMs?: number;
}) {
  const router = useRouter();
  const channelsKey = [...channelIds].sort().join(",");

  useEffect(() => {
    if (channelsKey.length === 0) return;
    const url =
      `/api/organizations/${organizationId}/growth-intelligence/performance-build` +
      `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}` +
      `&channels=${encodeURIComponent(channelsKey)}`;
    const controller = new AbortController();
    let stopped = false;

    async function poll(): Promise<void> {
      if (stopped) return;
      try {
        const response = await fetch(url, { signal: controller.signal });
        const body = (await response.json()) as { state: string };
        if (stopped) return;
        if (body.state === "ready" || body.state === "failed") {
          stopped = true;
          clearInterval(timer);
          router.refresh();
        }
      } catch {
        // A dropped poll is not a failed build: keep the previous state and
        // keep polling.
      }
    }

    const timer = setInterval(() => {
      void poll();
    }, pollMs);
    void poll();

    return () => {
      stopped = true;
      clearInterval(timer);
      controller.abort();
    };
  }, [organizationId, from, to, channelsKey, pollMs, router]);

  return null;
}
