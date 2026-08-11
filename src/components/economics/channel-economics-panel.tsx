"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { ChannelEconomicsClient } from "@/components/economics/channel-economics-client";
import type {
  EconomicsView,
  EconomicsWindowPreset,
} from "@/modules/economics/application/read-model";

/**
 * Puts the selected window in the URL.
 *
 * The window is a server concern — it decides which rows are read — so changing
 * it navigates rather than refetching on the client. Keeping it in the query
 * string also makes a view shareable, which matters for an agency operator
 * sending a client the exact period they are talking about.
 */
export function ChannelEconomicsPanel({
  view,
  organizationName,
  costStructureHref,
}: {
  view: EconomicsView;
  organizationName: string;
  costStructureHref: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function selectWindow(preset: EconomicsWindowPreset) {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    next.set("window", preset);
    router.replace(`?${next.toString()}`, { scroll: false });
  }

  return (
    <ChannelEconomicsClient
      view={view}
      organizationName={organizationName}
      costStructureHref={costStructureHref}
      onWindowChange={selectWindow}
    />
  );
}
