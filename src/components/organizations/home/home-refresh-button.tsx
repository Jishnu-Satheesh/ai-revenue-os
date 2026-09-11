"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import styles from "@/components/organizations/home/organization-home.module.css";

/**
 * The single refresh control for the whole home surface. It re-runs the
 * server load (`router.refresh()`) and nothing else: no worker, research,
 * render or mutation runs on refresh, readable content stays on screen while
 * pending, and the returned server state (including fresh per-source failures)
 * replaces whatever is shown. No timestamp is rendered here, so a refresh can
 * never present a retained `fetchedAt` as fresh.
 */
export function HomeRefreshButton({ label = "Retry" }: Readonly<{ label?: string }>) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      disabled={isPending}
      onClick={() => startTransition(() => router.refresh())}
      className={styles.homeButton}
    >
      <RefreshCw aria-hidden="true" data-icon="inline-start" />
      {isPending ? "Refreshing…" : label}
    </Button>
  );
}
